import * as assert from "assert";
import * as sinon from "sinon";
import * as yaml from "js-yaml";
import * as arm from "../../commands/utils/arm";
import { getKubernetesClientKubeconfigYaml } from "../../commands/utils/clusters";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { ContainerServiceClient, ManagedCluster } from "@azure/arm-containerservice";
import { CoreV1Api } from "@kubernetes/client-node";
import { createKubernetesClient } from "../../commands/utils/kubernetesClient";

describe("Kubernetes client AKS credentials", () => {
    const aksServerApplicationId = "6dae42f8-4368-4678-94ff-3960e28e3630";
    let sandbox: sinon.SinonSandbox;

    beforeEach(() => {
        sandbox = sinon.createSandbox();
    });

    afterEach(() => {
        sandbox.restore();
    });

    it("replaces ARM-provided AAD exec auth with a tenant-scoped AKS token", async () => {
        const getAuthSession = sandbox.stub().resolves({
            succeeded: true,
            result: { accessToken: "aks-access-token", tenantId: "tenant-id" },
        });
        const listCredentials = sandbox.stub().resolves({
            kubeconfigs: [{ name: "clusterUser", value: Buffer.from(createExecKubeconfig()) }],
        });
        sandbox.stub(arm, "getAksClient").returns({
            managedClusters: { listClusterUserCredentials: listCredentials },
        } as unknown as ContainerServiceClient);

        const result = await getKubernetesClientKubeconfigYaml(
            createSessionProvider(getAuthSession),
            "subscription-id",
            "resource-group",
            createManagedCluster(true),
        );

        assert.strictEqual(result.succeeded, true);
        if (!result.succeeded) return;

        const parsed = yaml.load(result.result) as {
            users: Array<{ name: string; user: { token?: string; exec?: unknown } }>;
        };
        assert.deepStrictEqual(parsed.users[0], {
            name: "cluster-user",
            user: { token: "aks-access-token" },
        });
        assert.ok(getAuthSession.calledOnceWithExactly({ scopes: [`${aksServerApplicationId}/.default`] }));
        assert.ok(
            listCredentials.calledOnceWithExactly("resource-group", "cluster-name", {
                format: "exec",
            }),
        );
    });

    it("keeps inline non-AAD credentials without requesting an AKS token", async () => {
        const getAuthSession = sandbox.stub();
        const kubeconfig = createTokenKubeconfig();
        const listCredentials = sandbox.stub().resolves({
            kubeconfigs: [{ name: "clusterUser", value: Buffer.from(kubeconfig) }],
        });
        sandbox.stub(arm, "getAksClient").returns({
            managedClusters: { listClusterUserCredentials: listCredentials },
        } as unknown as ContainerServiceClient);

        const result = await getKubernetesClientKubeconfigYaml(
            createSessionProvider(getAuthSession),
            "subscription-id",
            "resource-group",
            createManagedCluster(false),
        );

        assert.deepStrictEqual(result, { succeeded: true, result: kubeconfig });
        assert.strictEqual(getAuthSession.called, false);
        assert.ok(listCredentials.calledOnceWithExactly("resource-group", "cluster-name"));
    });

    it("prefers inline certificates when non-AAD credentials also contain a token", async () => {
        const getAuthSession = sandbox.stub();
        const kubeconfig = createKubeconfig([
            "      client-certificate-data: certificate-data",
            "      client-key-data: key-data",
            "      token: duplicate-token",
        ]);
        const listCredentials = sandbox.stub().resolves({
            kubeconfigs: [{ name: "clusterUser", value: Buffer.from(kubeconfig) }],
        });
        sandbox.stub(arm, "getAksClient").returns({
            managedClusters: { listClusterUserCredentials: listCredentials },
        } as unknown as ContainerServiceClient);

        const unnormalizedClient = createKubernetesClient(kubeconfig, CoreV1Api);
        assert.strictEqual(unnormalizedClient.succeeded, false);
        if (!unnormalizedClient.succeeded) {
            assert.match(unnormalizedClient.error, /exactly one supported authentication mechanism/);
        }

        const result = await getKubernetesClientKubeconfigYaml(
            createSessionProvider(getAuthSession),
            "subscription-id",
            "resource-group",
            createManagedCluster(false),
        );

        assert.strictEqual(result.succeeded, true);
        if (!result.succeeded) return;

        const parsed = yaml.load(result.result) as {
            users: Array<{ name: string; user: Record<string, string> }>;
        };
        assert.deepStrictEqual(parsed.users[0].user, {
            "client-certificate-data": "certificate-data",
            "client-key-data": "key-data",
        });
        assert.strictEqual(createKubernetesClient(result.result, CoreV1Api).succeeded, true);
        assert.strictEqual(getAuthSession.called, false);
        assert.ok(listCredentials.calledOnceWithExactly("resource-group", "cluster-name"));
    });

    it("rejects managed AAD clusters from a different tenant before requesting credentials", async () => {
        const getAuthSession = sandbox.stub();
        const getAksClient = sandbox.stub(arm, "getAksClient");
        const cluster = createManagedCluster(true);
        cluster.aadProfile!.tenantID = "other-tenant";

        const result = await getKubernetesClientKubeconfigYaml(
            createSessionProvider(getAuthSession),
            "subscription-id",
            "resource-group",
            cluster,
        );

        assert.deepStrictEqual(result, {
            succeeded: false,
            error: "The AKS cluster belongs to a different Microsoft Entra tenant.",
        });
        assert.strictEqual(getAksClient.calledOnce, true);
        assert.strictEqual(getAuthSession.called, false);
    });
});

function createSessionProvider(getAuthSession: sinon.SinonStub): ReadyAzureSessionProvider {
    return {
        signInStatus: "SignedIn",
        selectedTenant: { id: "tenant-id", name: "Tenant" },
        getAuthSession,
    } as unknown as ReadyAzureSessionProvider;
}

function createManagedCluster(aad: boolean): ManagedCluster & { id: string; name: string; location: string } {
    return {
        id: "/subscriptions/subscription-id/resourceGroups/resource-group/providers/Microsoft.ContainerService/managedClusters/cluster-name",
        name: "cluster-name",
        location: "eastus2",
        aadProfile: aad ? { managed: true } : undefined,
    };
}

function createExecKubeconfig(): string {
    return createKubeconfig(["      exec:", "        command: kubelogin", "        args: [get-token]"]);
}

function createTokenKubeconfig(): string {
    return createKubeconfig(["      token: existing-token"]);
}

function createKubeconfig(userConfig: string[]): string {
    return [
        "apiVersion: v1",
        "kind: Config",
        "clusters:",
        "  - name: cluster",
        "    cluster:",
        "      server: https://kubernetes.example.test",
        "contexts:",
        "  - name: context",
        "    context:",
        "      cluster: cluster",
        "      user: cluster-user",
        "current-context: context",
        "users:",
        "  - name: cluster-user",
        "    user:",
        ...userConfig,
    ].join("\n");
}
