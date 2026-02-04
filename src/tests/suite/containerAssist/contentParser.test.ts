import * as assert from "assert";
import {
    cleanMarkdownFences,
    extractContent,
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
  arbitrary: yaml`;
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
