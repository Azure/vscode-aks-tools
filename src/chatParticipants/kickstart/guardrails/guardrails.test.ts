import * as assert from "assert";
import { runGuardrails, applyRedact } from "./engine";
import type { GuardrailContribution, GuardrailInput, GuardrailResult } from "./types";
import { noCredentialLeakGuardrail } from "./core/noCredentialLeak";
import { noSecretsInArtifactsGuardrail } from "./core/noSecretsInArtifacts";
import { noPiiInLogsGuardrail } from "./core/noPiiInLogs";
import { noPrivilegedContainersGuardrail } from "./aks/noPrivilegedContainers";
import { requireResourceLimitsGuardrail } from "./aks/requireResourceLimits";
import { noHostpathVolumesGuardrail } from "./aks/noHostpathVolumes";
import { noLatestTagGuardrail } from "./aks/noLatestTag";
import { getDefaultGuardrails } from "./index";

const passGuardrail = (id: string): GuardrailContribution => ({
    id,
    appliesTo: ["*"],
    stages: ["input", "output", "tool"],
    async evaluate(): Promise<GuardrailResult> {
        return { verdict: "pass" };
    },
});

const blockGuardrail = (id: string): GuardrailContribution => ({
    id,
    appliesTo: ["*"],
    stages: ["input", "output", "tool"],
    async evaluate(): Promise<GuardrailResult> {
        return { verdict: "block", reason: "blocked" };
    },
});

const throwGuardrail = (id: string): GuardrailContribution => ({
    id,
    appliesTo: ["*"],
    stages: ["input"],
    async evaluate(): Promise<GuardrailResult> {
        throw new Error("boom");
    },
});

const redactInputGuardrail = (id: string, replacement: string): GuardrailContribution => ({
    id,
    appliesTo: ["*"],
    stages: ["input"],
    async evaluate(): Promise<GuardrailResult> {
        return { verdict: "redact", redacted: replacement };
    },
});

const orderTrackingGuardrail = (id: string, log: string[]): GuardrailContribution => ({
    id,
    appliesTo: ["*"],
    stages: ["input"],
    async evaluate(): Promise<GuardrailResult> {
        log.push(id);
        return { verdict: "pass" };
    },
});

const restrictedAgentGuardrail = (id: string, agents: string[]): GuardrailContribution => ({
    id,
    appliesTo: agents,
    stages: ["input"],
    async evaluate(): Promise<GuardrailResult> {
        return { verdict: "block" };
    },
});

describe("guardrails engine", () => {
    describe("runGuardrails", () => {
        it("returns blocked=false when no guardrails provided", async () => {
            const result = await runGuardrails("input", { stage: "input", userMessage: "hi" }, [], "agent-a");
            assert.strictEqual(result.blocked, false);
        });

        it("returns blocked=false when no guardrails match the stage", async () => {
            const onlyOutput: GuardrailContribution = {
                id: "x/only-output",
                appliesTo: ["*"],
                stages: ["output"],
                evaluate: async () => ({ verdict: "block" }),
            };
            const result = await runGuardrails("input", { stage: "input", userMessage: "hi" }, [onlyOutput], "a");
            assert.strictEqual(result.blocked, false);
        });

        it("returns blocked=true when a guardrail blocks", async () => {
            const result = await runGuardrails(
                "input",
                { stage: "input", userMessage: "hi" },
                [blockGuardrail("x/block")],
                "a",
            );
            assert.strictEqual(result.blocked, true);
        });

        it("treats throwing guardrails as block (fail-closed)", async () => {
            const result = await runGuardrails(
                "input",
                { stage: "input", userMessage: "hi" },
                [throwGuardrail("x/throw")],
                "a",
            );
            assert.strictEqual(result.blocked, true);
        });

        it("mutates input via redact and continues", async () => {
            const input: GuardrailInput = { stage: "input", userMessage: "original" };
            const result = await runGuardrails("input", input, [redactInputGuardrail("x/redact", "replaced")], "a");
            assert.strictEqual(result.blocked, false);
            assert.strictEqual(input.userMessage, "replaced");
        });

        it("runs core/ guardrails before non-core guardrails", async () => {
            const log: string[] = [];
            await runGuardrails(
                "input",
                { stage: "input", userMessage: "hi" },
                [
                    orderTrackingGuardrail("pack/second", log),
                    orderTrackingGuardrail("core/first", log),
                    orderTrackingGuardrail("pack/third", log),
                ],
                "a",
            );
            assert.deepStrictEqual(log, ["core/first", "pack/second", "pack/third"]);
        });

        it("chains redactions so downstream guardrails see redacted payload", async () => {
            const seen: string[] = [];
            const observer: GuardrailContribution = {
                id: "x/observer",
                appliesTo: ["*"],
                stages: ["input"],
                evaluate: async (i) => {
                    seen.push(i.userMessage ?? "");
                    return { verdict: "pass" };
                },
            };
            const input: GuardrailInput = { stage: "input", userMessage: "original" };
            await runGuardrails("input", input, [redactInputGuardrail("x/r", "replaced"), observer], "a");
            assert.deepStrictEqual(seen, ["replaced"]);
        });

        it("blocks if applyRedact fails (e.g. wrong type)", async () => {
            const badRedact: GuardrailContribution = {
                id: "x/bad-redact",
                appliesTo: ["*"],
                stages: ["input"],
                evaluate: async () => ({ verdict: "redact", redacted: 42 }),
            };
            const result = await runGuardrails("input", { stage: "input", userMessage: "hi" }, [badRedact], "a");
            assert.strictEqual(result.blocked, true);
        });

        it("filters by appliesTo glob (specific agent match)", async () => {
            const result = await runGuardrails(
                "input",
                { stage: "input", userMessage: "hi" },
                [restrictedAgentGuardrail("x/only-b", ["agent-b"])],
                "agent-a",
            );
            assert.strictEqual(result.blocked, false);
        });

        it("filters by appliesTo glob (wildcard match)", async () => {
            const result = await runGuardrails(
                "input",
                { stage: "input", userMessage: "hi" },
                [restrictedAgentGuardrail("x/all", ["*"])],
                "any-agent",
            );
            assert.strictEqual(result.blocked, true);
        });

        it("filters by appliesTo glob (pattern match)", async () => {
            const result = await runGuardrails(
                "input",
                { stage: "input", userMessage: "hi" },
                [restrictedAgentGuardrail("x/pattern", ["aks-*"])],
                "aks-reviewer",
            );
            assert.strictEqual(result.blocked, true);
        });

        it("doesn't run pass guardrail when stage doesn't match", async () => {
            let ran = false;
            const outputOnly: GuardrailContribution = {
                id: "x/output-only",
                appliesTo: ["*"],
                stages: ["output"],
                evaluate: async () => {
                    ran = true;
                    return { verdict: "pass" };
                },
            };
            await runGuardrails(
                "input",
                { stage: "input", userMessage: "hi" },
                [outputOnly, passGuardrail("x/p")],
                "a",
            );
            assert.strictEqual(ran, false);
        });
    });

    describe("applyRedact", () => {
        it("replaces userMessage for input stage", () => {
            const input: GuardrailInput = { stage: "input", userMessage: "old" };
            applyRedact(input, { verdict: "redact", redacted: "new" });
            assert.strictEqual(input.userMessage, "new");
        });

        it("replaces proposedOutput for output stage", () => {
            const input: GuardrailInput = { stage: "output", proposedOutput: "old" };
            applyRedact(input, { verdict: "redact", redacted: "new" });
            assert.strictEqual(input.proposedOutput, "new");
        });

        it("replaces toolArgs for tool stage via redactedArgs", () => {
            const input: GuardrailInput = { stage: "tool", toolName: "t", toolArgs: { a: 1 } };
            applyRedact(input, { verdict: "redact", redactedArgs: { a: 2 } });
            assert.deepStrictEqual(input.toolArgs, { a: 2 });
        });

        it("replaces toolArgs for tool stage via redacted", () => {
            const input: GuardrailInput = { stage: "tool", toolName: "t", toolArgs: { a: 1 } };
            applyRedact(input, { verdict: "redact", redacted: { b: 9 } });
            assert.deepStrictEqual(input.toolArgs, { b: 9 });
        });

        it("throws if redacted is not a string for input stage", () => {
            const input: GuardrailInput = { stage: "input", userMessage: "old" };
            assert.throws(() => applyRedact(input, { verdict: "redact", redacted: 42 }));
        });

        it("throws if redacted is not a string for output stage", () => {
            const input: GuardrailInput = { stage: "output", proposedOutput: "old" };
            assert.throws(() => applyRedact(input, { verdict: "redact", redacted: 42 }));
        });

        it("no-op when verdict is not redact", () => {
            const input: GuardrailInput = { stage: "input", userMessage: "old" };
            applyRedact(input, { verdict: "pass" });
            assert.strictEqual(input.userMessage, "old");
        });
    });
});

describe("core/no-credential-leak", () => {
    it("blocks Azure Bearer tokens", async () => {
        const r = await noCredentialLeakGuardrail.evaluate({
            stage: "input",
            userMessage: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMTIzNDU2In0.signature123ABCdef",
        });
        assert.strictEqual(r.verdict, "block");
    });

    it("blocks GitHub ghp_ PATs", async () => {
        const r = await noCredentialLeakGuardrail.evaluate({
            stage: "input",
            userMessage: "my token ghp_abcdefghijklmnopqrstuvwxyz1234567890 leaked",
        });
        assert.strictEqual(r.verdict, "block");
    });

    it("blocks GitHub ghs_ tokens", async () => {
        const r = await noCredentialLeakGuardrail.evaluate({
            stage: "output",
            proposedOutput: "ghs_abcdefghijklmnopqrstuvwxyz1234567890",
        });
        assert.strictEqual(r.verdict, "block");
    });

    it("blocks github_pat_ fine-grained tokens", async () => {
        const r = await noCredentialLeakGuardrail.evaluate({
            stage: "input",
            userMessage: "github_pat_abcdefghijklmnopqrstuvwxyz1234567890",
        });
        assert.strictEqual(r.verdict, "block");
    });

    it("blocks SSH private keys", async () => {
        const r = await noCredentialLeakGuardrail.evaluate({
            stage: "input",
            userMessage: "-----BEGIN RSA PRIVATE KEY-----\nMIIE...",
        });
        assert.strictEqual(r.verdict, "block");
    });

    it("blocks Azure SAS tokens", async () => {
        const r = await noCredentialLeakGuardrail.evaluate({
            stage: "tool",
            toolName: "x",
            toolArgs: { url: "https://acct.blob.core.windows.net/c?sv=2021-04-10&sig=abcdefghij123456789012345678" },
        });
        assert.strictEqual(r.verdict, "block");
    });

    it("blocks Azure connection strings", async () => {
        const r = await noCredentialLeakGuardrail.evaluate({
            stage: "input",
            userMessage: "AccountKey=abcdefghijklmnopqrstuvwxyz123456",
        });
        assert.strictEqual(r.verdict, "block");
    });

    it("passes clean text", async () => {
        const r = await noCredentialLeakGuardrail.evaluate({
            stage: "input",
            userMessage: "deploy my app to AKS",
        });
        assert.strictEqual(r.verdict, "pass");
    });

    it("works on tool stage by stringifying args", async () => {
        const r = await noCredentialLeakGuardrail.evaluate({
            stage: "tool",
            toolName: "write",
            toolArgs: { content: "ghp_abcdefghijklmnopqrstuvwxyz1234567890" },
        });
        assert.strictEqual(r.verdict, "block");
    });
});

describe("core/no-secrets-in-artifacts", () => {
    it("blocks write_file with api key pattern", async () => {
        const r = await noSecretsInArtifactsGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: "api_key=abcdefghijklmnopqrstuvwxyz" },
        });
        assert.strictEqual(r.verdict, "block");
    });

    it("blocks high-entropy tokens", async () => {
        const r = await noSecretsInArtifactsGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: "secret=aB3xQ9pL2vK7nM8jR4tY6wZ1cE5dF0gH" },
        });
        assert.strictEqual(r.verdict, "block");
    });

    it("passes for non-write_file tools", async () => {
        const r = await noSecretsInArtifactsGuardrail.evaluate({
            stage: "tool",
            toolName: "read_file",
            toolArgs: { content: "api_key=abcdefghijklmnopqrstuvwxyz" },
        });
        assert.strictEqual(r.verdict, "pass");
    });

    it("passes clean file content", async () => {
        const r = await noSecretsInArtifactsGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: "apiVersion: v1\nkind: Service\nmetadata:\n  name: my-svc" },
        });
        assert.strictEqual(r.verdict, "pass");
    });

    it("blocks AWS access keys", async () => {
        const r = await noSecretsInArtifactsGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: "AKIAIOSFODNN7EXAMPLE" },
        });
        assert.strictEqual(r.verdict, "block");
    });
});

describe("core/no-pii-in-logs", () => {
    it("redacts emails in output", async () => {
        const r = await noPiiInLogsGuardrail.evaluate({
            stage: "output",
            proposedOutput: "Contact me at user@example.com please",
        });
        assert.strictEqual(r.verdict, "redact");
        assert.match(r.redacted as string, /\[REDACTED-EMAIL\]/);
    });

    it("redacts SSNs in output", async () => {
        const r = await noPiiInLogsGuardrail.evaluate({
            stage: "output",
            proposedOutput: "SSN: 123-45-6789",
        });
        assert.strictEqual(r.verdict, "redact");
        assert.match(r.redacted as string, /\[REDACTED-SSN\]/);
    });

    it("redacts phone numbers in output", async () => {
        const r = await noPiiInLogsGuardrail.evaluate({
            stage: "output",
            proposedOutput: "Call 555-123-4567 anytime",
        });
        assert.strictEqual(r.verdict, "redact");
        assert.match(r.redacted as string, /\[REDACTED-PHONE\]/);
    });

    it("passes clean text", async () => {
        const r = await noPiiInLogsGuardrail.evaluate({
            stage: "output",
            proposedOutput: "deployment succeeded",
        });
        assert.strictEqual(r.verdict, "pass");
    });

    it("returns pass for input stage (only applies to output/tool)", async () => {
        const r = await noPiiInLogsGuardrail.evaluate({
            stage: "input",
            userMessage: "user@example.com",
        });
        assert.strictEqual(r.verdict, "pass");
    });

    it("redacts tool args via redactedArgs", async () => {
        const r = await noPiiInLogsGuardrail.evaluate({
            stage: "tool",
            toolName: "log",
            toolArgs: { message: "user@example.com signed in" },
        });
        assert.strictEqual(r.verdict, "redact");
        const args = r.redactedArgs as { message: string };
        assert.match(args.message, /\[REDACTED-EMAIL\]/);
    });
});

describe("aks/no-privileged-containers", () => {
    it("blocks privileged: true", async () => {
        const manifest = `apiVersion: v1
kind: Pod
spec:
  containers:
  - name: c
    image: foo:1.0
    securityContext:
      privileged: true`;
        const r = await noPrivilegedContainersGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: manifest },
        });
        assert.strictEqual(r.verdict, "block");
    });

    it("blocks allowPrivilegeEscalation: true", async () => {
        const manifest = `apiVersion: v1
kind: Pod
spec:
  containers:
  - securityContext:
      allowPrivilegeEscalation: true`;
        const r = await noPrivilegedContainersGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: manifest },
        });
        assert.strictEqual(r.verdict, "block");
    });

    it("blocks dangerous capability SYS_ADMIN", async () => {
        const manifest = `apiVersion: v1
kind: Pod
spec:
  containers:
  - name: c
    securityContext:
      capabilities:
        add:
        - SYS_ADMIN`;
        const r = await noPrivilegedContainersGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: manifest },
        });
        assert.strictEqual(r.verdict, "block");
    });

    it("passes safe manifests", async () => {
        const manifest = `apiVersion: v1
kind: Pod
spec:
  containers:
  - name: c
    image: foo:1.0
    securityContext:
      privileged: false
      runAsNonRoot: true`;
        const r = await noPrivilegedContainersGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: manifest },
        });
        assert.strictEqual(r.verdict, "pass");
    });

    it("passes non-K8s content", async () => {
        const r = await noPrivilegedContainersGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: "FROM alpine\nRUN echo privileged: true" },
        });
        assert.strictEqual(r.verdict, "pass");
    });
});

describe("aks/require-resource-limits", () => {
    it("blocks manifests with containers but no limits", async () => {
        const manifest = `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: c
        image: foo:1.0`;
        const r = await requireResourceLimitsGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: manifest },
        });
        assert.strictEqual(r.verdict, "block");
    });

    it("passes manifests with limits", async () => {
        const manifest = `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: c
        image: foo:1.0
        resources:
          limits:
            cpu: 500m
            memory: 256Mi`;
        const r = await requireResourceLimitsGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: manifest },
        });
        assert.strictEqual(r.verdict, "pass");
    });

    it("passes manifests with no containers (e.g. Service)", async () => {
        const manifest = `apiVersion: v1
kind: Service
metadata:
  name: my-svc
spec:
  ports:
  - port: 80`;
        const r = await requireResourceLimitsGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: manifest },
        });
        assert.strictEqual(r.verdict, "pass");
    });

    it("passes non-K8s content", async () => {
        const r = await requireResourceLimitsGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: "just some text containers: foo" },
        });
        assert.strictEqual(r.verdict, "pass");
    });
});

describe("aks/no-hostpath-volumes", () => {
    it("blocks manifests with hostPath", async () => {
        const manifest = `apiVersion: v1
kind: Pod
spec:
  volumes:
  - name: host-data
    hostPath:
      path: /data`;
        const r = await noHostpathVolumesGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: manifest },
        });
        assert.strictEqual(r.verdict, "block");
    });

    it("passes valid manifests without hostPath", async () => {
        const manifest = `apiVersion: v1
kind: Pod
spec:
  volumes:
  - name: cache
    emptyDir: {}`;
        const r = await noHostpathVolumesGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: manifest },
        });
        assert.strictEqual(r.verdict, "pass");
    });

    it("passes non-K8s content", async () => {
        const r = await noHostpathVolumesGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: "some hostPath: docs only" },
        });
        assert.strictEqual(r.verdict, "pass");
    });
});

describe("aks/no-latest-tag", () => {
    it("blocks image with :latest tag", async () => {
        const manifest = `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: c
        image: myacr.azurecr.io/app:latest`;
        const r = await noLatestTagGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: manifest },
        });
        assert.strictEqual(r.verdict, "block");
    });

    it("passes pinned image tags", async () => {
        const manifest = `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: c
        image: myacr.azurecr.io/app:1.2.3`;
        const r = await noLatestTagGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: manifest },
        });
        assert.strictEqual(r.verdict, "pass");
    });

    it("passes non-K8s content with :latest in it", async () => {
        const r = await noLatestTagGuardrail.evaluate({
            stage: "tool",
            toolName: "write_file",
            toolArgs: { content: "this is the latest update" },
        });
        assert.strictEqual(r.verdict, "pass");
    });
});

describe("getDefaultGuardrails", () => {
    it("returns 7 guardrails", () => {
        assert.strictEqual(getDefaultGuardrails().length, 7);
    });

    it("contains all expected ids", () => {
        const ids = getDefaultGuardrails().map((g) => g.id);
        assert.ok(ids.includes("core/no-credential-leak"));
        assert.ok(ids.includes("core/no-secrets-in-artifacts"));
        assert.ok(ids.includes("core/no-pii-in-logs"));
        assert.ok(ids.includes("aks/no-privileged-containers"));
        assert.ok(ids.includes("aks/require-resource-limits"));
        assert.ok(ids.includes("aks/no-hostpath-volumes"));
        assert.ok(ids.includes("aks/no-latest-tag"));
    });

    it("orders core/ guardrails before aks/ guardrails", () => {
        const ids = getDefaultGuardrails().map((g) => g.id);
        const lastCoreIdx = Math.max(...ids.map((id, i) => (id.startsWith("core/") ? i : -1)));
        const firstAksIdx = ids.findIndex((id) => id.startsWith("aks/"));
        assert.ok(lastCoreIdx < firstAksIdx);
    });
});
