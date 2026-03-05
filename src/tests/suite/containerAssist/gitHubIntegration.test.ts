import * as assert from "assert";
import { generateCommitMessage } from "../../../commands/aksContainerAssist/gitHubIntegration";

describe("generateCommitMessage", () => {
    it("all three file types", () => {
        const files = ["/app/Dockerfile", "/app/k8s/deployment.yaml", "/app/.github/workflows/deploy.yml"];
        assert.strictEqual(
            generateCommitMessage(files, "myapp"),
            "Add: Dockerfile, k8s manifests and GitHub Action workflow for myapp",
        );
    });

    it("Dockerfile and k8s manifests only", () => {
        const files = ["/app/Dockerfile", "/app/k8s/deployment.yaml", "/app/k8s/service.yaml"];
        assert.strictEqual(generateCommitMessage(files, "myapp"), "Add: Dockerfile and k8s manifests for myapp");
    });

    it("workflow only", () => {
        const files = ["/app/.github/workflows/deploy.yml"];
        assert.strictEqual(generateCommitMessage(files, "myapp"), "Add: GitHub Action workflow for myapp");
    });

    it("Dockerfile only", () => {
        const files = ["/app/Dockerfile"];
        assert.strictEqual(generateCommitMessage(files, "myapp"), "Add: Dockerfile for myapp");
    });

    it("k8s manifests only", () => {
        const files = ["/app/k8s/deployment.yaml"];
        assert.strictEqual(generateCommitMessage(files, "myapp"), "Add: k8s manifests for myapp");
    });

    it("falls back to basename for unknown files", () => {
        const files = ["/app/README.md"];
        assert.strictEqual(generateCommitMessage(files, "myapp"), "Add: README.md for myapp");
    });
});
