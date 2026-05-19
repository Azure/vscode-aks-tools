import * as assert from "assert";
import { reviewArtifacts, formatReviewFindings } from "./review";
import { StagedFile } from "./state";

const stagedFile = (filename: string, content: string): StagedFile => ({
    filename,
    content,
    stagedPath: `/tmp/${filename}`,
    status: "staged",
    generatedAt: Date.now(),
});

describe("reviewArtifacts", () => {
    it("passes when no guardrails violated", async () => {
        const dockerfile = stagedFile(
            "Dockerfile",
            'FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install\nCMD ["node", "index.js"]',
        );
        const manifest = stagedFile(
            "k8s/deployment.yaml",
            `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: app
        image: myacr.azurecr.io/app:1.0.0
        resources:
          limits:
            cpu: 500m
            memory: 256Mi`,
        );

        const result = await reviewArtifacts([dockerfile, manifest]);
        assert.strictEqual(result.passed, true);
        assert.strictEqual(result.findings.length, 0);
    });

    it("fails when manifest uses :latest tag", async () => {
        const manifest = stagedFile(
            "k8s/deployment.yaml",
            `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: app
        image: myacr.azurecr.io/app:latest
        resources:
          limits:
            cpu: 500m
            memory: 256Mi`,
        );

        const result = await reviewArtifacts([manifest]);
        assert.strictEqual(result.passed, false);
        assert.ok(result.findings.some((f) => f.guardrailId === "aks/no-latest-tag"));
    });

    it("fails when manifest has privileged container", async () => {
        const manifest = stagedFile(
            "k8s/deployment.yaml",
            `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: app
        image: myacr.azurecr.io/app:1.0.0
        securityContext:
          privileged: true
        resources:
          limits:
            cpu: 500m`,
        );

        const result = await reviewArtifacts([manifest]);
        assert.strictEqual(result.passed, false);
        assert.ok(result.findings.some((f) => f.guardrailId === "aks/no-privileged-containers"));
    });

    it("fails when manifest lacks resource limits", async () => {
        const manifest = stagedFile(
            "k8s/deployment.yaml",
            `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: app
        image: myacr.azurecr.io/app:1.0.0`,
        );

        const result = await reviewArtifacts([manifest]);
        assert.strictEqual(result.passed, false);
        assert.ok(result.findings.some((f) => f.guardrailId === "aks/require-resource-limits"));
    });

    it("fails when manifest mounts hostPath volume", async () => {
        const manifest = stagedFile(
            "k8s/deployment.yaml",
            `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      volumes:
      - name: host-data
        hostPath:
          path: /data
      containers:
      - name: app
        image: myacr.azurecr.io/app:1.0.0
        resources:
          limits:
            cpu: 500m`,
        );

        const result = await reviewArtifacts([manifest]);
        assert.strictEqual(result.passed, false);
        assert.ok(result.findings.some((f) => f.guardrailId === "aks/no-hostpath-volumes"));
    });

    it("collects findings across multiple files", async () => {
        const m1 = stagedFile(
            "k8s/deployment.yaml",
            `apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - image: foo:latest`,
        );
        const m2 = stagedFile(
            "k8s/cron.yaml",
            `apiVersion: batch/v1
kind: CronJob
spec:
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - image: bar:latest`,
        );

        const result = await reviewArtifacts([m1, m2]);
        assert.strictEqual(result.passed, false);
        const filenames = result.findings.map((f) => f.filename);
        assert.ok(filenames.includes("k8s/deployment.yaml"));
        assert.ok(filenames.includes("k8s/cron.yaml"));
    });
});

describe("formatReviewFindings", () => {
    it("returns success message when passed", () => {
        const formatted = formatReviewFindings({ passed: true, findings: [] });
        assert.match(formatted, /Review passed/);
    });

    it("groups findings by filename when failed", () => {
        const formatted = formatReviewFindings({
            passed: false,
            findings: [
                { filename: "a.yaml", guardrailId: "x/g1", reason: "bad" },
                { filename: "a.yaml", guardrailId: "x/g2", reason: "worse" },
                { filename: "b.yaml", guardrailId: "x/g1", reason: "ugly" },
            ],
        });
        assert.match(formatted, /Review failed/);
        assert.match(formatted, /\*\*a\.yaml\*\*/);
        assert.match(formatted, /\*\*b\.yaml\*\*/);
        assert.match(formatted, /x\/g1/);
        assert.match(formatted, /x\/g2/);
    });
});
