import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as vscode from "vscode";
import {
    buildArgoCDAppYaml,
    buildReadmeMarkdown,
    writeArgoCDArtifacts,
} from "../../../commands/aksArgoCD/argoCDDeployment";

describe("argoCDDeployment", () => {
    let tempDir: string;

    before(() => {
        // buildArgoCDAppYaml reads the YAML template via getExtensionPath(),
        // which resolves from the registered extension's path — no activation
        // required (activation is skipped in the test host, which lacks the
        // vscode-kubernetes-tools dependency).
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "argocd-test-"));
    });

    after(() => {
        if (tempDir) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe("buildArgoCDAppYaml", () => {
        it("substitutes all placeholders", () => {
            const yaml = buildArgoCDAppYaml({
                appName: "my-app",
                configRepoUrl: "https://github.com/my-org/my-app",
                clusterServer: "https://kubernetes.default.svc",
                namespace: "prod",
                appPath: "k8s",
            });

            assert.ok(yaml.includes("name: my-app"), "app name substituted");
            assert.ok(yaml.includes("repoURL: https://github.com/my-org/my-app"), "repo url substituted");
            assert.ok(yaml.includes("server: https://kubernetes.default.svc"), "cluster server substituted");
            assert.ok(yaml.includes("namespace: prod"), "namespace substituted");
            assert.ok(yaml.includes("path: k8s"), "manifest path substituted");
        });

        it("leaves no unresolved template tokens", () => {
            const yaml = buildArgoCDAppYaml({
                appName: "a",
                configRepoUrl: "u",
                clusterServer: "s",
                namespace: "n",
                appPath: "p",
            });
            assert.ok(!/\{\{[A-Z_]+\}\}/.test(yaml), "no {{PLACEHOLDER}} tokens remain");
        });

        it("does not emit a source-repo annotation (opinion-free)", () => {
            const yaml = buildArgoCDAppYaml({
                appName: "a",
                configRepoUrl: "u",
                clusterServer: "s",
                namespace: "n",
                appPath: "p",
            });
            assert.ok(!yaml.includes("source-repo"), "no source-repo annotation");
        });
    });

    describe("buildReadmeMarkdown", () => {
        it("includes the chosen values and no separate-repo / Hollywood messaging", () => {
            const md = buildReadmeMarkdown({
                appName: "my-app",
                namespace: "prod",
                manifestRepoUrl: "https://github.com/my-org/my-app",
                manifestPath: "k8s",
            });

            assert.ok(md.includes("my-app"), "app name present");
            assert.ok(md.includes("https://github.com/my-org/my-app"), "repo url present");
            assert.ok(md.includes("prod"), "namespace present");
            assert.ok(!/Hollywood/i.test(md), "no Hollywood Principle messaging");
            assert.ok(!/separate/i.test(md), "no separate-repo prescription");
        });
    });

    describe("writeArgoCDArtifacts", () => {
        function baseParams(outputPath: string, includeReadme: boolean) {
            return {
                targetFolderUri: vscode.Uri.file(tempDir),
                outputPath,
                appName: "my-app",
                manifestRepoUrl: "https://github.com/my-org/my-app",
                manifestPath: "k8s",
                clusterServer: "https://kubernetes.default.svc",
                namespace: "default",
                includeReadme,
            };
        }

        it("creates the output folder and writes application.yaml", async () => {
            const outDir = "argocd";
            const result = await writeArgoCDArtifacts(baseParams(outDir, false));

            const expectedDir = path.join(tempDir, outDir);
            assert.ok(fs.existsSync(expectedDir), "output directory was created");
            assert.ok(fs.statSync(expectedDir).isDirectory(), "output path is a directory");
            assert.ok(fs.existsSync(path.join(expectedDir, "my-app.yaml")), "application.yaml written");
            assert.strictEqual(result.readmeUri, undefined, "no README when not requested");
        });

        it("creates nested output folders recursively (mkdir -p behavior)", async () => {
            const outDir = path.join("manifests", "gitops", "argocd");
            await writeArgoCDArtifacts(baseParams(outDir, false));

            const expectedDir = path.join(tempDir, outDir);
            assert.ok(fs.existsSync(expectedDir), "nested output directory chain created");
            assert.ok(fs.existsSync(path.join(expectedDir, "my-app.yaml")), "application.yaml written in nested dir");
        });

        it("writes the README when includeReadme is true", async () => {
            const outDir = "with-readme";
            const result = await writeArgoCDArtifacts(baseParams(outDir, true));

            const expectedDir = path.join(tempDir, outDir);
            assert.ok(fs.existsSync(path.join(expectedDir, "my-app.yaml")), "application.yaml written");
            assert.ok(fs.existsSync(path.join(expectedDir, "my-app-README.md")), "README written");
            assert.ok(result.readmeUri, "readmeUri returned");
        });

        it("does not error when the output folder already exists", async () => {
            const outDir = "pre-existing";
            fs.mkdirSync(path.join(tempDir, outDir));

            // Should not throw.
            await writeArgoCDArtifacts(baseParams(outDir, false));

            assert.ok(
                fs.existsSync(path.join(tempDir, outDir, "my-app.yaml")),
                "application.yaml written into existing folder",
            );
        });

        it("writes to the workspace root when outputPath is empty", async () => {
            // Use a dedicated root so we don't collide with other cases.
            const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "argocd-root-"));
            try {
                await writeArgoCDArtifacts({
                    targetFolderUri: vscode.Uri.file(rootDir),
                    outputPath: "",
                    appName: "root-app",
                    manifestRepoUrl: "https://github.com/my-org/my-app",
                    manifestPath: "k8s",
                    clusterServer: "https://kubernetes.default.svc",
                    namespace: "default",
                    includeReadme: false,
                });
                assert.ok(fs.existsSync(path.join(rootDir, "root-app.yaml")), "yaml written at root");
            } finally {
                fs.rmSync(rootDir, { recursive: true, force: true });
            }
        });
    });
});
