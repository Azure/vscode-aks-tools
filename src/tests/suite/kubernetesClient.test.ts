import * as assert from "assert";
import { CoreV1Api } from "@kubernetes/client-node";
import { createKubernetesClient, replaceKubeconfigUserAuthWithToken } from "../../commands/utils/kubernetesClient";

describe("Kubernetes client factory", () => {
    it("creates a typed API client from inline credentials", () => {
        const client = createKubernetesClient(createKubeconfig(), CoreV1Api);

        assert.strictEqual(client.succeeded, true);
        if (client.succeeded) {
            assert.strictEqual(typeof client.result.listNamespace, "function");
        }
    });

    it("rejects malformed kubeconfig YAML", () => {
        const client = createKubernetesClient("users: [", CoreV1Api);

        assert.strictEqual(client.succeeded, false);
        if (!client.succeeded) {
            assert.match(client.error, /Failed to parse kubeconfig YAML/);
        }
    });

    it("rejects plaintext Kubernetes API endpoints", () => {
        const client = createKubernetesClient(
            createKubeconfig({ server: "http://kubernetes.example.test" }),
            CoreV1Api,
        );

        assert.strictEqual(client.succeeded, false);
        if (!client.succeeded) {
            assert.match(client.error, /require an HTTPS server URL/);
        }
    });

    it("rejects kubeconfig TLS verification bypass", () => {
        const client = createKubernetesClient(
            createKubeconfig({ clusterConfig: ["      insecure-skip-tls-verify: true"] }),
            CoreV1Api,
        );

        assert.strictEqual(client.succeeded, false);
        if (!client.succeeded) {
            assert.match(client.error, /require TLS certificate verification/);
        }
    });

    it("rejects process-wide TLS verification bypass", () => {
        const previousValue = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
        try {
            const client = createKubernetesClient(createKubeconfig(), CoreV1Api);

            assert.strictEqual(client.succeeded, false);
            if (!client.succeeded) {
                assert.match(client.error, /NODE_TLS_REJECT_UNAUTHORIZED/);
            }
        } finally {
            if (previousValue === undefined) {
                delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
            } else {
                process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousValue;
            }
        }
    });

    it("rejects executable credential providers even when a token is present", () => {
        const client = createKubernetesClient(
            createKubeconfig({
                userConfig: [
                    "      token: test-token",
                    "      exec:",
                    "        command: /tmp/untrusted-credential-plugin",
                    "        args: [get-token]",
                ],
            }),
            CoreV1Api,
        );

        assert.strictEqual(client.succeeded, false);
        if (!client.succeeded) {
            assert.match(client.error, /unsupported authentication mechanism/);
        }
    });

    it("rejects path-backed and provider-backed credentials before client construction", () => {
        for (const userConfig of [
            ["      token-file: /tmp/untrusted-token"],
            ["      client-certificate: /tmp/untrusted-cert", "      client-key: /tmp/untrusted-key"],
            ["      auth-provider:", "        name: tokenFile", "        config:", "          tokenFile: /tmp/token"],
        ]) {
            const client = createKubernetesClient(createKubeconfig({ userConfig }), CoreV1Api);
            assert.strictEqual(client.succeeded, false);
            if (!client.succeeded) {
                assert.match(client.error, /unsupported authentication mechanism/);
            }
        }
    });

    it("rejects path-backed certificate authority data and proxy URLs", () => {
        for (const clusterConfig of [
            ["      certificate-authority: /tmp/untrusted-ca"],
            ["      proxy-url: https://proxy.example.test"],
        ]) {
            const client = createKubernetesClient(createKubeconfig({ clusterConfig }), CoreV1Api);
            assert.strictEqual(client.succeeded, false);
        }
    });

    it("rejects oversized kubeconfigs before parsing", () => {
        const client = createKubernetesClient(" ".repeat(1024 * 1024 + 1), CoreV1Api);

        assert.strictEqual(client.succeeded, false);
        if (!client.succeeded) {
            assert.match(client.error, /1 MiB safety limit/);
        }
    });
});

describe("Kubernetes client kubeconfig authentication", () => {
    it("creates a minimal kubeconfig for the current context with the supplied token", () => {
        const kubeconfig = createKubeconfig({
            userConfig: ["      exec:", "        command: kubelogin", "        args: [get-token]"],
            additionalUsers: ["  - name: unused-user", "    user:", "      token: keep-this-token"],
        });

        const result = replaceKubeconfigUserAuthWithToken(kubeconfig, "new-aks-token");

        assert.strictEqual(result.succeeded, true);
        if (result.succeeded) {
            assert.match(result.result, /token: new-aks-token/);
            assert.doesNotMatch(result.result, /keep-this-token/);
            assert.doesNotMatch(result.result, /unused-user/);
            assert.doesNotMatch(result.result, /command: kubelogin/);
        }
    });

    it("fails when the current context does not identify a user", () => {
        const kubeconfig = createKubeconfig().replace("      user: test-user\n", "");

        const result = replaceKubeconfigUserAuthWithToken(kubeconfig, "new-aks-token");

        assert.strictEqual(result.succeeded, false);
    });
});

function createKubeconfig(options?: {
    server?: string;
    clusterConfig?: string[];
    userConfig?: string[];
    additionalUsers?: string[];
}): string {
    return [
        "apiVersion: v1",
        "kind: Config",
        "clusters:",
        "  - name: test-cluster",
        "    cluster:",
        `      server: ${options?.server ?? "https://kubernetes.example.test"}`,
        ...(options?.clusterConfig ?? []),
        "contexts:",
        "  - name: test-context",
        "    context:",
        "      cluster: test-cluster",
        "      user: test-user",
        "current-context: test-context",
        "users:",
        "  - name: test-user",
        "    user:",
        ...(options?.userConfig ?? ["      token: test-token"]),
        ...(options?.additionalUsers ?? []),
    ].join("\n");
}
