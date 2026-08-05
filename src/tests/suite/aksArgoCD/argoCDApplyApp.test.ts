import * as assert from "assert";
import * as k8s from "vscode-kubernetes-tools-api";
import { parseArgoCDPort, detectArgoCDConfiguredPort } from "../../../commands/aksArgoCD/argoCDApplyApp";

/**
 * Builds a fake kubectl whose `argocd-cm` reads return the supplied values.
 *
 * `detectArgoCDConfiguredPort` issues one jsonpath query per key, so dispatch on
 * whether the command asks for `global.domain` or `url`.
 */
function fakeKubectl(data: { url?: string; globalDomain?: string }): k8s.APIAvailable<k8s.KubectlV1> {
    return {
        available: true,
        api: {
            invokeCommand: async (command: string) => ({
                code: 0,
                stdout: command.includes("global") ? (data.globalDomain ?? "") : (data.url ?? ""),
                stderr: "",
            }),
        },
    } as unknown as k8s.APIAvailable<k8s.KubectlV1>;
}

describe("argoCDApplyApp — parseArgoCDPort", () => {
    it("parses a port from a full https URL", () => {
        assert.strictEqual(parseArgoCDPort("https://localhost:9000"), 9000);
    });

    it("parses a port from a full http URL", () => {
        assert.strictEqual(parseArgoCDPort("http://localhost:8081"), 8081);
    });

    it("parses a port from a bare host:port value, the form global.domain uses", () => {
        assert.strictEqual(parseArgoCDPort("localhost:9000"), 9000);
    });

    it("parses a port from a real hostname with a port", () => {
        assert.strictEqual(parseArgoCDPort("argocd.example.com:8443"), 8443);
    });

    it("ignores a trailing path when extracting the port", () => {
        assert.strictEqual(parseArgoCDPort("https://localhost:9000/argocd"), 9000);
    });

    it("strips surrounding quotes (jsonpath output)", () => {
        assert.strictEqual(parseArgoCDPort('"https://localhost:9000"'), 9000);
    });

    it("returns undefined when there is no explicit port (URL)", () => {
        assert.strictEqual(parseArgoCDPort("https://localhost"), undefined);
    });

    it("returns undefined when there is no explicit port (bare host)", () => {
        assert.strictEqual(parseArgoCDPort("argocd.example.com"), undefined);
    });

    it("returns undefined for empty / undefined input", () => {
        assert.strictEqual(parseArgoCDPort(""), undefined);
        assert.strictEqual(parseArgoCDPort(undefined), undefined);
    });

    it("returns undefined for an out-of-range port", () => {
        assert.strictEqual(parseArgoCDPort("localhost:70000"), undefined);
        assert.strictEqual(parseArgoCDPort("localhost:0"), undefined);
    });
});

describe("argoCDApplyApp — detectArgoCDConfiguredPort", () => {
    const KUBECONFIG = "/tmp/kubeconfig";

    it("prefers the port from argocd-cm 'url'", async () => {
        const port = await detectArgoCDConfiguredPort(fakeKubectl({ url: "https://localhost:9000" }), KUBECONFIG);
        assert.strictEqual(port, 9000);
    });

    it("falls back to 'global.domain' when 'url' is not set", async () => {
        const port = await detectArgoCDConfiguredPort(fakeKubectl({ globalDomain: "localhost:9443" }), KUBECONFIG);
        assert.strictEqual(port, 9443);
    });

    it("falls back to 'global.domain' when 'url' carries no explicit port", async () => {
        const port = await detectArgoCDConfiguredPort(
            fakeKubectl({ url: "https://argocd.example.com", globalDomain: "argocd.example.com:8443" }),
            KUBECONFIG,
        );
        assert.strictEqual(port, 8443);
    });

    it("defaults to 8080 when neither key is configured", async () => {
        assert.strictEqual(await detectArgoCDConfiguredPort(fakeKubectl({}), KUBECONFIG), 8080);
    });
});
