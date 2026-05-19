import * as assert from "assert";
import { parseGitHubRemote, createPullRequest, generatePRBody, generatePRTitle } from "./githubHandoff";

describe("parseGitHubRemote", () => {
    it("parses SSH URLs", () => {
        assert.deepStrictEqual(parseGitHubRemote("git@github.com:Azure/vscode-aks-tools.git"), {
            owner: "Azure",
            repo: "vscode-aks-tools",
        });
    });

    it("parses SSH URLs without .git suffix", () => {
        assert.deepStrictEqual(parseGitHubRemote("git@github.com:Azure/vscode-aks-tools"), {
            owner: "Azure",
            repo: "vscode-aks-tools",
        });
    });

    it("parses HTTPS URLs", () => {
        assert.deepStrictEqual(parseGitHubRemote("https://github.com/Azure/vscode-aks-tools.git"), {
            owner: "Azure",
            repo: "vscode-aks-tools",
        });
    });

    it("parses HTTPS URLs without .git suffix", () => {
        assert.deepStrictEqual(parseGitHubRemote("https://github.com/Azure/vscode-aks-tools"), {
            owner: "Azure",
            repo: "vscode-aks-tools",
        });
    });

    it("parses HTTPS URLs with user@", () => {
        assert.deepStrictEqual(parseGitHubRemote("https://user@github.com/Azure/vscode-aks-tools.git"), {
            owner: "Azure",
            repo: "vscode-aks-tools",
        });
    });

    it("parses http URLs", () => {
        assert.deepStrictEqual(parseGitHubRemote("http://github.com/foo/bar"), {
            owner: "foo",
            repo: "bar",
        });
    });

    it("returns undefined for non-GitHub URLs", () => {
        assert.strictEqual(parseGitHubRemote("git@gitlab.com:foo/bar.git"), undefined);
        assert.strictEqual(parseGitHubRemote("https://bitbucket.org/foo/bar"), undefined);
    });

    it("returns undefined for empty string", () => {
        assert.strictEqual(parseGitHubRemote(""), undefined);
    });

    it("trims whitespace before matching", () => {
        assert.deepStrictEqual(parseGitHubRemote("  git@github.com:Azure/vscode-aks-tools.git\n"), {
            owner: "Azure",
            repo: "vscode-aks-tools",
        });
    });
});

describe("generatePRTitle", () => {
    it("returns a stable title", () => {
        assert.match(generatePRTitle(), /AKS/);
        assert.match(generatePRTitle(), /Kickstart/);
    });
});

describe("generatePRBody", () => {
    it("includes all file names", () => {
        const body = generatePRBody(["Dockerfile", "k8s/deployment.yaml", "k8s/service.yaml"]);
        assert.match(body, /Dockerfile/);
        assert.match(body, /k8s\/deployment\.yaml/);
        assert.match(body, /k8s\/service\.yaml/);
    });

    it("documents safety guarantees", () => {
        const body = generatePRBody(["Dockerfile"]);
        assert.match(body, /Resource limits/);
        assert.match(body, /:latest/);
        assert.match(body, /privileged/);
        assert.match(body, /hostPath/);
        assert.match(body, /secrets/);
    });
});

describe("createPullRequest", () => {
    it("calls the GitHub API with correct payload and headers", async () => {
        let capturedUrl = "";
        let capturedInit: RequestInit = {};
        const fakeFetch: typeof fetch = async (input, init) => {
            capturedUrl = String(input);
            capturedInit = init ?? {};
            return {
                ok: true,
                status: 201,
                async json() {
                    return JSON.parse('{"number":42,"html_url":"https://github.com/foo/bar/pull/42"}');
                },
                async text() {
                    return "";
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any;
        };

        const result = await createPullRequest({
            repo: { owner: "foo", repo: "bar" },
            branch: "kickstart/x",
            base: "main",
            title: "T",
            body: "B",
            token: "tok",
            fetchFn: fakeFetch,
        });

        assert.deepStrictEqual(result, { prNumber: 42, htmlUrl: "https://github.com/foo/bar/pull/42" });
        assert.strictEqual(capturedUrl, "https://api.github.com/repos/foo/bar/pulls");
        assert.strictEqual(capturedInit.method, "POST");

        const headers = capturedInit.headers as Record<string, string>;
        assert.strictEqual(headers["Authorization"], "Bearer tok");
        assert.strictEqual(headers["X-GitHub-Api-Version"], "2022-11-28");

        const body = JSON.parse(capturedInit.body as string);
        assert.deepStrictEqual(body, { title: "T", body: "B", head: "kickstart/x", base: "main" });
    });

    it("throws on non-OK response", async () => {
        const fakeFetch: typeof fetch = async () =>
            ({
                ok: false,
                status: 403,
                async text() {
                    return "Forbidden";
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            }) as any;

        await assert.rejects(
            createPullRequest({
                repo: { owner: "foo", repo: "bar" },
                branch: "x",
                base: "main",
                title: "T",
                body: "B",
                token: "tok",
                fetchFn: fakeFetch,
            }),
            /GitHub API error 403/,
        );
    });
});
