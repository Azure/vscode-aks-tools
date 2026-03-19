import * as assert from "assert";
import {
    cleanMarkdownFences,
    extractContent,
    fixManifestImageReferences,
    parseManifestsFromLMResponse,
    parseYamlDocuments,
} from "../../../commands/aksContainerAssist/contentParser";

describe("contentParser", () => {
    describe("cleanMarkdownFences", () => {
        it("removes dockerfile fence", () => {
            const input = "```dockerfile\nFROM node:20\nWORKDIR /app\n```";
            assert.strictEqual(cleanMarkdownFences(input, "dockerfile"), "FROM node:20\nWORKDIR /app");
        });

        it("removes docker fence", () => {
            const input = "```docker\nFROM node:20\n```";
            assert.strictEqual(cleanMarkdownFences(input, "dockerfile"), "FROM node:20");
        });

        it("removes yaml fence", () => {
            const input = "```yaml\napiVersion: v1\nkind: Service\n```";
            assert.strictEqual(cleanMarkdownFences(input, "yaml"), "apiVersion: v1\nkind: Service");
        });

        it("removes generic fence", () => {
            const input = "```\nsome content\n```";
            assert.strictEqual(cleanMarkdownFences(input, "dockerfile"), "some content");
        });

        it("trims content without fences", () => {
            assert.strictEqual(cleanMarkdownFences("  FROM node:20  ", "dockerfile"), "FROM node:20");
        });
    });

    describe("extractContent", () => {
        it("extracts from content marker", () => {
            const input = "<content>FROM node:20\nWORKDIR /app</content>";
            assert.strictEqual(extractContent(input, "dockerfile"), "FROM node:20\nWORKDIR /app");
        });

        it("joins multiple content markers", () => {
            const input = "<content>content1</content>text<content>content2</content>";
            assert.strictEqual(extractContent(input, "dockerfile"), "content1\n---\ncontent2");
        });

        it("falls back to markdown fence cleaning", () => {
            const input = "```dockerfile\nFROM node:20\n```";
            assert.strictEqual(extractContent(input, "dockerfile"), "FROM node:20");
        });

        it("handles case-insensitive markers", () => {
            const input = "<CONTENT>FROM node:20</CONTENT>";
            assert.strictEqual(extractContent(input, "dockerfile"), "FROM node:20");
        });
    });

    describe("parseManifestsFromLMResponse", () => {
        it("parses filename markers", () => {
            const input = `<content filename="deployment.yaml">
apiVersion: apps/v1
kind: Deployment
</content>
<content filename="service.yaml">
apiVersion: v1
kind: Service
</content>`;
            const result = parseManifestsFromLMResponse(input, "test-app");

            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].filename, "deployment.yaml");
            assert.strictEqual(result[1].filename, "service.yaml");
        });

        it("determines filename from kind", () => {
            const input = `<content>
apiVersion: apps/v1
kind: Deployment
---
apiVersion: v1
kind: Service
</content>`;
            const result = parseManifestsFromLMResponse(input, "test-app");

            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].filename, "deployment.yaml");
            assert.strictEqual(result[1].filename, "service.yaml");
        });

        it("parses raw YAML documents", () => {
            const input = `apiVersion: apps/v1
kind: Deployment
---
apiVersion: v1
kind: Service`;
            const result = parseManifestsFromLMResponse(input, "test-app");

            assert.strictEqual(result.length, 2);
        });

        it("handles single-quoted filenames", () => {
            const input = `<content filename='deployment.yaml'>
apiVersion: apps/v1
kind: Deployment
</content>`;
            const result = parseManifestsFromLMResponse(input, "test-app");

            assert.strictEqual(result[0].filename, "deployment.yaml");
        });
    });

    describe("fixManifestImageReferences", () => {
        it("replaces <your-acr-name> placeholder", () => {
            const manifests = [
                {
                    filename: "deployment.yaml",
                    content: "image: <your-acr-name>.azurecr.io/myapp:latest",
                },
            ];
            const result = fixManifestImageReferences(manifests, "realacr.azurecr.io/myapp");
            assert.strictEqual(result[0].content, "image: realacr.azurecr.io/myapp:latest");
        });

        it("replaces wrong ACR name", () => {
            const manifests = [
                {
                    filename: "deployment.yaml",
                    content: "image: otheracr.azurecr.io/myapp:v1",
                },
            ];
            const result = fixManifestImageReferences(manifests, "correctacr.azurecr.io/myapp");
            assert.strictEqual(result[0].content, "image: correctacr.azurecr.io/myapp:v1");
        });

        it("leaves correct image unchanged", () => {
            const manifests = [
                {
                    filename: "deployment.yaml",
                    content: "image: realacr.azurecr.io/myapp:latest",
                },
            ];
            const result = fixManifestImageReferences(manifests, "realacr.azurecr.io/myapp");
            assert.strictEqual(result[0].content, "image: realacr.azurecr.io/myapp:latest");
        });

        it("replaces multiple occurrences", () => {
            const manifests = [
                {
                    filename: "deployment.yaml",
                    content: "image: <acr>.azurecr.io/myapp:v1\n        image: <acr>.azurecr.io/myapp:v2",
                },
            ];
            const result = fixManifestImageReferences(manifests, "real.azurecr.io/myapp");
            assert.ok(result[0].content.includes("real.azurecr.io/myapp:v1"));
            assert.ok(result[0].content.includes("real.azurecr.io/myapp:v2"));
        });

        it("handles multi-level ACR path", () => {
            const manifests = [
                {
                    filename: "deployment.yaml",
                    content: "image: <acr>.azurecr.io/team/myapp:v1",
                },
            ];
            const result = fixManifestImageReferences(manifests, "realacr.azurecr.io/myapp");
            assert.strictEqual(result[0].content, "image: realacr.azurecr.io/myapp:v1");
        });

        it("does not replace unrelated sidecar images", () => {
            const manifests = [
                {
                    filename: "deployment.yaml",
                    content: "image: <your-acr>.azurecr.io/myapp:v1\n        image: docker.io/envoyproxy/envoy:v1.28",
                },
            ];
            const result = fixManifestImageReferences(manifests, "realacr.azurecr.io/myapp");
            assert.ok(result[0].content.includes("realacr.azurecr.io/myapp:v1"));
            assert.ok(result[0].content.includes("docker.io/envoyproxy/envoy:v1.28"));
        });

        it("replaces ${} style placeholder", () => {
            const manifests = [
                {
                    filename: "deployment.yaml",
                    content: "image: ${ACR_NAME}.azurecr.io/myapp:latest",
                },
            ];
            const result = fixManifestImageReferences(manifests, "realacr.azurecr.io/myapp");
            assert.strictEqual(result[0].content, "image: realacr.azurecr.io/myapp:latest");
        });

        it("replaces {{}} style placeholder", () => {
            const manifests = [
                {
                    filename: "deployment.yaml",
                    content: "image: {{acr_name}}.azurecr.io/myapp:latest",
                },
            ];
            const result = fixManifestImageReferences(manifests, "realacr.azurecr.io/myapp");
            assert.strictEqual(result[0].content, "image: realacr.azurecr.io/myapp:latest");
        });

        it("is a no-op when imageRepository is not an azurecr.io reference", () => {
            const manifests = [
                {
                    filename: "deployment.yaml",
                    content: "image: docker.io/myorg/myapp:latest",
                },
            ];
            const result = fixManifestImageReferences(manifests, "docker.io/myorg/myapp");
            assert.strictEqual(result[0].content, "image: docker.io/myorg/myapp:latest");
        });

        it("handles image ref without tag", () => {
            const manifests = [
                {
                    filename: "deployment.yaml",
                    content: "image: <your-acr>.azurecr.io/myapp\n",
                },
            ];
            const result = fixManifestImageReferences(manifests, "realacr.azurecr.io/myapp");
            assert.ok(result[0].content.startsWith("image: realacr.azurecr.io/myapp"));
        });
    });

    describe("parseYamlDocuments", () => {
        it("splits by separator", () => {
            const input = `apiVersion: v1
kind: Service
---
apiVersion: apps/v1
kind: Deployment`;
            assert.strictEqual(parseYamlDocuments(input, "test-app").length, 2);
        });

        it("extracts filename from comment", () => {
            const input = `# deployment.yaml
apiVersion: apps/v1
kind: Deployment`;
            assert.strictEqual(parseYamlDocuments(input, "test-app")[0].filename, "deployment.yaml");
        });

        it("uses kind as filename", () => {
            const input = `apiVersion: apps/v1
kind: Deployment`;
            assert.strictEqual(parseYamlDocuments(input, "test-app")[0].filename, "deployment.yaml");
        });

        it("uses fallback name for unknown content", () => {
            const input = `some:
  arbitrary: yaml
---
more:
  data: here`;
            assert.ok(parseYamlDocuments(input, "my-app")[0].filename.includes("my-app"));
        });

        it("renames single unknown document to deployment.yaml", () => {
            const input = `apiVersion: v1
metadata:
  name: test`;
            assert.strictEqual(parseYamlDocuments(input, "test-app")[0].filename, "deployment.yaml");
        });

        it("ignores empty documents", () => {
            const input = `---
apiVersion: v1
kind: Service
---
---`;
            assert.strictEqual(parseYamlDocuments(input, "test-app").length, 1);
        });
    });
});
