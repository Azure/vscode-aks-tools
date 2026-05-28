import * as assert from "assert";
import { runAgents, InMemoryAgentRegistry } from "./runner";
import { HANDOFF_TOOL_NAME, parseHandoffCall } from "./handoff";
import type { Agent } from "./types";

const minimalAgent = (overrides: Partial<Agent> & Pick<Agent, "name">): Agent => ({
    description: "",
    systemPrompt: "",
    tools: [],
    handoffTargets: [],
    ...overrides,
});

type FakeResponse =
    | { kind: "text"; text: string }
    | { kind: "handoff"; toAgent: string; summary: string }
    | { kind: "tool"; name: string; input: unknown; thenText: string };

interface FakeLM {
    sendRequestWithTools: (
        sys: string,
        user: string,
        opts: unknown,
    ) => Promise<{ succeeded: boolean; result: string; error?: string }>;
}

function makeFakeLM(scriptByAgent: Map<string, FakeResponse[]>): FakeLM {
    const cursors = new Map<string, number>();

    return {
        async sendRequestWithTools(_sys: string, _user: string, opts: unknown) {
            const o = opts as {
                toolHandler: (call: { name: string; callId: string; input: unknown }) => Promise<string>;
                agentName?: string;
            };
            const agentName = o.agentName ?? "";
            const script = scriptByAgent.get(agentName) ?? [];
            const idx = cursors.get(agentName) ?? 0;
            const step = script[idx];
            cursors.set(agentName, idx + 1);

            if (!step) {
                return { succeeded: true, result: "default-response" };
            }

            if (step.kind === "text") {
                return { succeeded: true, result: step.text };
            }

            if (step.kind === "handoff") {
                await o.toolHandler({
                    name: HANDOFF_TOOL_NAME,
                    callId: "call-1",
                    input: { toAgent: step.toAgent, summary: step.summary },
                });
                return { succeeded: true, result: `handing off to ${step.toAgent}` };
            }

            if (step.kind === "tool") {
                await o.toolHandler({ name: step.name, callId: "call-1", input: step.input });
                return { succeeded: true, result: step.thenText };
            }

            return { succeeded: true, result: "default-response" };
        },
    };
}

describe("agents/handoff parseHandoffCall", () => {
    it("returns undefined for non-handoff calls", () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = parseHandoffCall({ name: "other", callId: "x", input: {} } as any);
        assert.strictEqual(r, undefined);
    });

    it("returns parsed handoff for valid input", () => {
        const r = parseHandoffCall({
            name: HANDOFF_TOOL_NAME,
            callId: "x",
            input: { toAgent: "codesmith", summary: "do thing" },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        assert.deepStrictEqual(r, { toAgent: "codesmith", summary: "do thing" });
    });

    it("returns undefined for invalid input shape", () => {
        const r = parseHandoffCall({
            name: HANDOFF_TOOL_NAME,
            callId: "x",
            input: { toAgent: 42 },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        assert.strictEqual(r, undefined);
    });
});

describe("agents/InMemoryAgentRegistry", () => {
    it("registers and retrieves agents", () => {
        const reg = new InMemoryAgentRegistry();
        const a = minimalAgent({ name: "a" });
        reg.register(a);
        assert.strictEqual(reg.get("a"), a);
        assert.strictEqual(reg.get("missing"), undefined);
    });

    it("lists all registered agents", () => {
        const reg = new InMemoryAgentRegistry();
        reg.register(minimalAgent({ name: "a" }));
        reg.register(minimalAgent({ name: "b" }));
        assert.strictEqual(reg.list().length, 2);
    });
});

describe("agents/runAgents", () => {
    it("returns completed=true when agent responds without handoff", async () => {
        const reg = new InMemoryAgentRegistry();
        reg.register(minimalAgent({ name: "triage" }));

        const script = new Map<string, FakeResponse[]>();
        script.set("triage", [{ kind: "text", text: "all done" }]);

        const result = await runAgents({
            initialAgent: "triage",
            userMessage: "hi",
            registry: reg,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lmClient: makeFakeLM(script) as any,
            toolHandler: async () => "tool-result",
        });

        assert.strictEqual(result.completed, true);
        assert.strictEqual(result.finalAgent, "triage");
        assert.strictEqual(result.turns.length, 1);
        assert.strictEqual(result.handoffs.length, 0);
    });

    it("handles a single handoff", async () => {
        const reg = new InMemoryAgentRegistry();
        reg.register(minimalAgent({ name: "triage", handoffTargets: ["codesmith"] }));
        reg.register(minimalAgent({ name: "codesmith" }));

        const script = new Map<string, FakeResponse[]>();
        script.set("triage", [{ kind: "handoff", toAgent: "codesmith", summary: "generate dockerfile" }]);
        script.set("codesmith", [{ kind: "text", text: "generated" }]);

        const result = await runAgents({
            initialAgent: "triage",
            userMessage: "build my app",
            registry: reg,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lmClient: makeFakeLM(script) as any,
            toolHandler: async () => "tool-result",
        });

        assert.strictEqual(result.completed, true);
        assert.strictEqual(result.finalAgent, "codesmith");
        assert.strictEqual(result.handoffs.length, 1);
        assert.deepStrictEqual(result.handoffs[0], { toAgent: "codesmith", summary: "generate dockerfile" });
        assert.strictEqual(result.turns.length, 2);
        assert.strictEqual(result.turns[1].userMessage, "generate dockerfile");
    });

    it("handles a chain of handoffs", async () => {
        const reg = new InMemoryAgentRegistry();
        reg.register(minimalAgent({ name: "triage", handoffTargets: ["codesmith"] }));
        reg.register(minimalAgent({ name: "codesmith", handoffTargets: ["reviewer"] }));
        reg.register(minimalAgent({ name: "reviewer" }));

        const script = new Map<string, FakeResponse[]>();
        script.set("triage", [{ kind: "handoff", toAgent: "codesmith", summary: "go" }]);
        script.set("codesmith", [{ kind: "handoff", toAgent: "reviewer", summary: "check this" }]);
        script.set("reviewer", [{ kind: "text", text: "looks good" }]);

        const result = await runAgents({
            initialAgent: "triage",
            userMessage: "build",
            registry: reg,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lmClient: makeFakeLM(script) as any,
            toolHandler: async () => "tool-result",
        });

        assert.strictEqual(result.completed, true);
        assert.strictEqual(result.finalAgent, "reviewer");
        assert.strictEqual(result.handoffs.length, 2);
        assert.strictEqual(result.turns.length, 3);
    });

    it("rejects handoff to agent not in handoffTargets", async () => {
        const reg = new InMemoryAgentRegistry();
        reg.register(minimalAgent({ name: "triage", handoffTargets: ["codesmith"] }));
        reg.register(minimalAgent({ name: "codesmith" }));
        reg.register(minimalAgent({ name: "reviewer" }));

        const script = new Map<string, FakeResponse[]>();
        script.set("triage", [{ kind: "handoff", toAgent: "reviewer", summary: "skip codesmith" }]);

        const result = await runAgents({
            initialAgent: "triage",
            userMessage: "build",
            registry: reg,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lmClient: makeFakeLM(script) as any,
            toolHandler: async () => "tool-result",
        });

        assert.strictEqual(result.completed, true);
        assert.strictEqual(result.handoffs.length, 0);
        assert.strictEqual(result.finalAgent, "triage");
    });

    it("returns completed=false when initial agent not found", async () => {
        const reg = new InMemoryAgentRegistry();

        const result = await runAgents({
            initialAgent: "missing",
            userMessage: "hi",
            registry: reg,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lmClient: makeFakeLM(new Map()) as any,
            toolHandler: async () => "",
        });

        assert.strictEqual(result.completed, false);
        assert.strictEqual(result.finalAgent, "missing");
    });

    it("returns completed=false when LM call fails", async () => {
        const reg = new InMemoryAgentRegistry();
        reg.register(minimalAgent({ name: "triage" }));

        const failingLM = {
            sendRequestWithTools: async () => ({ succeeded: false as const, error: "no model" }),
        };

        const result = await runAgents({
            initialAgent: "triage",
            userMessage: "hi",
            registry: reg,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lmClient: failingLM as any,
            toolHandler: async () => "",
        });

        assert.strictEqual(result.completed, false);
        assert.strictEqual(result.turns.length, 1);
    });

    it("stops after maxHandoffs is exceeded", async () => {
        const reg = new InMemoryAgentRegistry();
        reg.register(minimalAgent({ name: "a", handoffTargets: ["b"] }));
        reg.register(minimalAgent({ name: "b", handoffTargets: ["a"] }));

        const script = new Map<string, FakeResponse[]>();
        const responses: FakeResponse[] = [
            { kind: "handoff", toAgent: "b", summary: "ping" },
            { kind: "handoff", toAgent: "b", summary: "ping" },
            { kind: "handoff", toAgent: "b", summary: "ping" },
        ];
        script.set("a", responses);
        script.set("b", [
            { kind: "handoff", toAgent: "a", summary: "pong" },
            { kind: "handoff", toAgent: "a", summary: "pong" },
            { kind: "handoff", toAgent: "a", summary: "pong" },
        ]);

        const result = await runAgents({
            initialAgent: "a",
            userMessage: "start",
            registry: reg,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lmClient: makeFakeLM(script) as any,
            toolHandler: async () => "",
            maxHandoffs: 2,
        });

        assert.strictEqual(result.completed, false);
        assert.strictEqual(result.handoffs.length, 3);
    });

    it("delegates non-handoff tool calls to user toolHandler", async () => {
        const reg = new InMemoryAgentRegistry();
        reg.register(minimalAgent({ name: "triage" }));

        const script = new Map<string, FakeResponse[]>();
        script.set("triage", [{ kind: "tool", name: "readProjectFile", input: { path: "x" }, thenText: "done" }]);

        let toolCalled = false;
        await runAgents({
            initialAgent: "triage",
            userMessage: "inspect",
            registry: reg,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lmClient: makeFakeLM(script) as any,
            toolHandler: async (call) => {
                toolCalled = true;
                assert.strictEqual(call.name, "readProjectFile");
                return "file contents";
            },
        });

        assert.strictEqual(toolCalled, true);
    });
});
