import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
    scanForDockerfiles,
    scanForK8sManifests,
    scanManifestsForModulePaths,
} from "../../../commands/aksContainerAssist/fileOperations";

describe("fileOperations", () => {
    let tempDir: string;

    before(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "fileops-test-"));
    });

    after(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });

    describe("scanForDockerfiles", () => {
        let dockerDir: string;

        before(() => {
            dockerDir = path.join(tempDir, "docker-scan");
            fs.mkdirSync(dockerDir);
        });

        it("finds a Dockerfile at root level", async () => {
            const dir = path.join(dockerDir, "root-level");
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM node:20");

            const result = await scanForDockerfiles(dir);

            assert.strictEqual(result.length, 1);
            assert.ok(result[0].endsWith("Dockerfile"));
        });

        it("finds Dockerfiles in subdirectories", async () => {
            const dir = path.join(dockerDir, "nested");
            fs.mkdirSync(dir);
            fs.mkdirSync(path.join(dir, "frontend"), { recursive: true });
            fs.mkdirSync(path.join(dir, "api"), { recursive: true });
            fs.writeFileSync(path.join(dir, "frontend", "Dockerfile"), "FROM node:20");
            fs.writeFileSync(path.join(dir, "api", "Dockerfile"), "FROM python:3.12");

            const result = await scanForDockerfiles(dir);

            assert.strictEqual(result.length, 2);
            assert.ok(result.some((p) => p.includes("frontend")));
            assert.ok(result.some((p) => p.includes("api")));
        });

        it("returns shallowest Dockerfile first", async () => {
            const dir = path.join(dockerDir, "depth-order");
            fs.mkdirSync(dir);
            fs.mkdirSync(path.join(dir, "services", "web"), { recursive: true });
            fs.writeFileSync(path.join(dir, "services", "web", "Dockerfile"), "FROM node:20");
            fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM alpine");

            const result = await scanForDockerfiles(dir);

            assert.strictEqual(result.length, 2);
            // Root Dockerfile should come first (shallowest)
            assert.ok(result[0].endsWith(path.join("depth-order", "Dockerfile")));
        });

        it("ignores files in excluded directories", async () => {
            const dir = path.join(dockerDir, "excluded");
            fs.mkdirSync(dir);
            fs.mkdirSync(path.join(dir, "node_modules", "some-pkg"), { recursive: true });
            fs.mkdirSync(path.join(dir, "src"), { recursive: true });
            fs.writeFileSync(path.join(dir, "node_modules", "some-pkg", "Dockerfile"), "FROM node:20");
            fs.writeFileSync(path.join(dir, "src", "Dockerfile"), "FROM node:20");

            const result = await scanForDockerfiles(dir);

            assert.strictEqual(result.length, 1);
            assert.ok(result[0].includes("src"));
        });

        it("does not match files containing 'Dockerfile' in the name", async () => {
            const dir = path.join(dockerDir, "exact-match");
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, "Dockerfile"), "FROM node:20");
            fs.writeFileSync(path.join(dir, "Dockerfile.bak"), "FROM node:18");
            fs.writeFileSync(path.join(dir, "README-Dockerfile.md"), "docs");

            const result = await scanForDockerfiles(dir);

            assert.strictEqual(result.length, 1);
            assert.ok(result[0].endsWith("Dockerfile"));
        });

        it("returns empty array when no Dockerfiles exist", async () => {
            const dir = path.join(dockerDir, "empty");
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, "index.ts"), "console.log('hello')");

            const result = await scanForDockerfiles(dir);

            assert.strictEqual(result.length, 0);
        });

        it("returns empty array for non-existent directory", async () => {
            const result = await scanForDockerfiles(path.join(dockerDir, "does-not-exist"));
            assert.strictEqual(result.length, 0);
        });

        it("does not scan beyond depth 3", async () => {
            const dir = path.join(dockerDir, "deep");
            // depth 0: dir, 1: a, 2: b, 3: c, 4: d — Dockerfile at depth 4 should not be found
            const deepPath = path.join(dir, "a", "b", "c", "d");
            fs.mkdirSync(deepPath, { recursive: true });
            fs.writeFileSync(path.join(deepPath, "Dockerfile"), "FROM alpine");
            // Dockerfile at depth 3 should be found
            fs.writeFileSync(path.join(dir, "a", "b", "c", "Dockerfile"), "FROM alpine");

            const result = await scanForDockerfiles(dir);

            assert.strictEqual(result.length, 1);
            assert.ok(result[0].includes(path.join("a", "b", "c", "Dockerfile")));
            assert.ok(!result[0].includes(path.join("c", "d", "Dockerfile")));
        });

        it("skips Java/IDE excluded directories", async () => {
            const dir = path.join(dockerDir, "java-excluded");
            fs.mkdirSync(dir);
            for (const excluded of [".gradle", ".idea", ".settings", ".mvn"]) {
                fs.mkdirSync(path.join(dir, excluded), { recursive: true });
                fs.writeFileSync(path.join(dir, excluded, "Dockerfile"), "FROM gradle");
            }
            fs.mkdirSync(path.join(dir, "app"), { recursive: true });
            fs.writeFileSync(path.join(dir, "app", "Dockerfile"), "FROM openjdk:21");

            const result = await scanForDockerfiles(dir);

            assert.strictEqual(result.length, 1);
            assert.ok(result[0].includes("app"));
        });
    });

    describe("scanForK8sManifests", () => {
        let k8sDir: string;

        before(() => {
            k8sDir = path.join(tempDir, "k8s-scan");
            fs.mkdirSync(k8sDir);
        });

        it("finds valid K8s manifests (.yaml)", async () => {
            const dir = path.join(k8sDir, "yaml-ext");
            fs.mkdirSync(path.join(dir, "k8s"), { recursive: true });
            fs.writeFileSync(
                path.join(dir, "k8s", "deployment.yaml"),
                "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n",
            );

            const result = await scanForK8sManifests(dir);

            assert.strictEqual(result.length, 1);
            assert.ok(result[0].endsWith("deployment.yaml"));
        });

        it("finds valid K8s manifests (.yml)", async () => {
            const dir = path.join(k8sDir, "yml-ext");
            fs.mkdirSync(path.join(dir, "manifests"), { recursive: true });
            fs.writeFileSync(
                path.join(dir, "manifests", "service.yml"),
                "apiVersion: v1\nkind: Service\nmetadata:\n  name: web\n",
            );

            const result = await scanForK8sManifests(dir);

            assert.strictEqual(result.length, 1);
            assert.ok(result[0].endsWith("service.yml"));
        });

        it("ignores YAML files that are not K8s manifests", async () => {
            const dir = path.join(k8sDir, "non-k8s");
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, "config.yaml"), "database:\n  host: localhost\n  port: 5432\n");

            const result = await scanForK8sManifests(dir);

            assert.strictEqual(result.length, 0);
        });

        it("ignores YAML with apiVersion but no valid kind", async () => {
            const dir = path.join(k8sDir, "no-kind");
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, "bad.yaml"), "apiVersion: v1\ndata:\n  key: value\n");

            const result = await scanForK8sManifests(dir);

            assert.strictEqual(result.length, 0);
        });

        it("ignores YAML with kind but no apiVersion", async () => {
            const dir = path.join(k8sDir, "no-api");
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, "bad.yaml"), "kind: Deployment\nmetadata:\n  name: web\n");

            const result = await scanForK8sManifests(dir);

            assert.strictEqual(result.length, 0);
        });

        it("handles CRLF line endings", async () => {
            const dir = path.join(k8sDir, "crlf");
            fs.mkdirSync(dir);
            fs.writeFileSync(
                path.join(dir, "deploy.yaml"),
                "apiVersion: apps/v1\r\nkind: Deployment\r\nmetadata:\r\n  name: web\r\n",
            );

            const result = await scanForK8sManifests(dir);

            assert.strictEqual(result.length, 1);
        });

        it("returns empty array when no manifests exist", async () => {
            const dir = path.join(k8sDir, "empty");
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, "README.md"), "# Hello");

            const result = await scanForK8sManifests(dir);

            assert.strictEqual(result.length, 0);
        });

        it("returns empty array for non-existent directory", async () => {
            const result = await scanForK8sManifests(path.join(k8sDir, "does-not-exist"));
            assert.strictEqual(result.length, 0);
        });

        it("ignores non-YAML files", async () => {
            const dir = path.join(k8sDir, "mixed-files");
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, "readme.md"), "# docs");
            fs.writeFileSync(path.join(dir, "config.json"), '{"key":"value"}');
            fs.writeFileSync(
                path.join(dir, "deploy.yaml"),
                "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n",
            );

            const result = await scanForK8sManifests(dir);

            assert.strictEqual(result.length, 1);
            assert.ok(result[0].endsWith("deploy.yaml"));
        });

        it("rejects kind values that are not PascalCase", async () => {
            const dir = path.join(k8sDir, "bad-kind");
            fs.mkdirSync(dir);
            fs.writeFileSync(path.join(dir, "lower.yaml"), "apiVersion: v1\nkind: deployment\n");
            fs.writeFileSync(path.join(dir, "dashed.yaml"), "apiVersion: v1\nkind: My-Resource\n");

            const result = await scanForK8sManifests(dir);

            assert.strictEqual(result.length, 0);
        });

        it("finds manifests in directories with spaces in path", async () => {
            const dir = path.join(k8sDir, "my service");
            fs.mkdirSync(path.join(dir, "k8s"), { recursive: true });
            fs.writeFileSync(
                path.join(dir, "k8s", "deploy.yaml"),
                "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: svc\n",
            );

            const result = await scanForK8sManifests(dir);

            assert.strictEqual(result.length, 1);
        });
    });

    describe("scanManifestsForModulePaths", () => {
        let modulesDir: string;

        before(() => {
            modulesDir = path.join(tempDir, "modules-scan");
            fs.mkdirSync(modulesDir);
        });

        const writeManifest = (file: string, kind: string = "Deployment") => {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, `apiVersion: apps/v1\nkind: ${kind}\nmetadata:\n  name: x\n`);
        };

        it("returns a map keyed by module path with absolute manifest paths", async () => {
            const root = path.join(modulesDir, "happy");
            const frontend = path.join(root, "frontend");
            const api = path.join(root, "api");
            writeManifest(path.join(frontend, "k8s", "deployment.yaml"));
            writeManifest(path.join(api, "k8s", "deployment.yaml"), "Deployment");
            writeManifest(path.join(api, "k8s", "service.yaml"), "Service");

            const result = await scanManifestsForModulePaths([frontend, api]);

            assert.strictEqual(result.size, 2);
            assert.ok(result.has(frontend));
            assert.ok(result.has(api));
            assert.strictEqual(result.get(frontend)!.length, 1);
            assert.ok(result.get(frontend)![0].endsWith(path.join("frontend", "k8s", "deployment.yaml")));
            assert.strictEqual(result.get(api)!.length, 2);
            assert.ok(result.get(api)!.every((p) => path.isAbsolute(p)));
        });

        it("represents modules with no k8s folder as an empty array (not omitted)", async () => {
            const root = path.join(modulesDir, "missing");
            const withK8s = path.join(root, "with");
            const without = path.join(root, "without");
            fs.mkdirSync(without, { recursive: true });
            writeManifest(path.join(withK8s, "k8s", "deployment.yaml"));

            const result = await scanManifestsForModulePaths([withK8s, without]);

            assert.strictEqual(result.size, 2);
            assert.strictEqual(result.get(withK8s)!.length, 1);
            assert.deepStrictEqual(result.get(without), []);
        });

        it("represents modules with empty k8s folder as an empty array", async () => {
            const root = path.join(modulesDir, "empty-k8s");
            fs.mkdirSync(path.join(root, "k8s"), { recursive: true });

            const result = await scanManifestsForModulePaths([root]);

            assert.deepStrictEqual(result.get(root), []);
        });

        it("supports a custom k8s folder name", async () => {
            const root = path.join(modulesDir, "custom-folder");
            writeManifest(path.join(root, "manifests", "deployment.yaml"));
            // A "k8s" folder elsewhere with a manifest should NOT be picked up.
            writeManifest(path.join(root, "k8s", "deployment.yaml"));

            const result = await scanManifestsForModulePaths([root], "manifests");

            assert.strictEqual(result.get(root)!.length, 1);
            assert.ok(result.get(root)![0].includes(path.join("manifests", "deployment.yaml")));
        });

        it("deduplicates repeated module paths in the input", async () => {
            const root = path.join(modulesDir, "dup");
            writeManifest(path.join(root, "k8s", "deployment.yaml"));

            const result = await scanManifestsForModulePaths([root, root, root]);

            // Even though the input had 3 entries, the map should have a single key.
            assert.strictEqual(result.size, 1);
            assert.strictEqual(result.get(root)!.length, 1);
        });

        it("returns an empty map when given no module paths", async () => {
            const result = await scanManifestsForModulePaths([]);
            assert.strictEqual(result.size, 0);
        });

        it("paths in the map are workspace-convertible via path.relative by callers", async () => {
            const workspaceRoot = path.join(modulesDir, "ws");
            const moduleAbs = path.join(workspaceRoot, "services", "api");
            writeManifest(path.join(moduleAbs, "k8s", "deployment.yaml"));

            const result = await scanManifestsForModulePaths([moduleAbs]);
            const hits = result.get(moduleAbs)!;
            assert.strictEqual(hits.length, 1);
            const rel = path.relative(workspaceRoot, hits[0]);
            assert.ok(!rel.startsWith(".."), `Manifest path should be inside workspace; got ${rel}`);
            assert.ok(rel.endsWith(path.join("services", "api", "k8s", "deployment.yaml")));
        });
    });
});
