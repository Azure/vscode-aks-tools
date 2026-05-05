import * as assert from "assert";
import * as sinon from "sinon";
import * as clustersModule from "./clusters";
import { getClusterPrincipalId } from "./identities";
import { ReadyAzureSessionProvider } from "../../auth/types";
import { ClusterKey } from "../../webview-contract/webviewDefinitions/attachAcrToCluster";

describe("getClusterPrincipalId", () => {
    let sandbox: sinon.SinonSandbox;
    let getManagedClusterStub: sinon.SinonStub;

    const fakeSessionProvider = {} as ReadyAzureSessionProvider;
    const fakeClusterKey: ClusterKey = {
        subscriptionId: "sub-1",
        resourceGroup: "rg-1",
        clusterName: "cluster-1",
    };

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        getManagedClusterStub = sandbox.stub(clustersModule, "getManagedCluster");
    });

    afterEach(() => {
        sandbox.restore();
    });

    it("returns kubelet objectId when cluster has SystemAssigned identity and kubeletidentity profile", async () => {
        getManagedClusterStub.resolves({
            succeeded: true,
            result: {
                identity: { type: "SystemAssigned" },
                identityProfile: {
                    kubeletidentity: { objectId: "kubelet-oid" },
                },
            },
        });

        const result = await getClusterPrincipalId(fakeSessionProvider, fakeClusterKey);

        assert.deepStrictEqual(result, { succeeded: true, result: "kubelet-oid" });
    });

    it("returns error when cluster has SystemAssigned identity but kubeletidentity objectId is missing", async () => {
        getManagedClusterStub.resolves({
            succeeded: true,
            result: {
                identity: { type: "SystemAssigned" },
                identityProfile: {},
            },
        });

        const result = await getClusterPrincipalId(fakeSessionProvider, fakeClusterKey);

        assert.strictEqual(result.succeeded, false);
        assert.ok(!result.succeeded && result.error.length > 0, "Expected a non-empty error message");
    });

    it("returns service principal clientId when cluster has no managed identity", async () => {
        getManagedClusterStub.resolves({
            succeeded: true,
            result: {
                identity: undefined,
                servicePrincipalProfile: { clientId: "sp-cid" },
            },
        });

        const result = await getClusterPrincipalId(fakeSessionProvider, fakeClusterKey);

        assert.deepStrictEqual(result, { succeeded: true, result: "sp-cid" });
    });

    it("returns kubelet identity (not service principal) when cluster has both managed identity and service principal", async () => {
        getManagedClusterStub.resolves({
            succeeded: true,
            result: {
                identity: { type: "SystemAssigned" },
                identityProfile: {
                    kubeletidentity: { objectId: "kubelet-oid" },
                },
                servicePrincipalProfile: { clientId: "sp-cid" },
            },
        });

        const result = await getClusterPrincipalId(fakeSessionProvider, fakeClusterKey);

        assert.deepStrictEqual(result, { succeeded: true, result: "kubelet-oid" });
    });
});
