import * as assert from "assert";
import { ManagedCluster } from "@azure/arm-containerservice";
import { normalizeUpgradeProfileResponse } from "../../commands/utils/clusters";
import { asClusterInfo, postClusterProperties } from "../../panels/ClusterPropertiesPanel";
import { MessageSink } from "../../webview-contract/messaging";
import { ToWebViewMsgDef } from "../../webview-contract/webviewDefinitions/clusterProperties";

describe("Cluster properties panel", () => {
    const cluster: ManagedCluster = {
        id: "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.ContainerService/managedClusters/cluster",
        name: "cluster",
        location: "eastus",
    };

    it("maps incomplete ARM responses without throwing", () => {
        const info = asClusterInfo({
            ...cluster,
            kubernetesVersion: "1.31.1",
            agentPoolProfiles: [{ name: "system" }],
        });

        assert.strictEqual(info.provisioningState, "Unknown");
        assert.strictEqual(info.fqdn, "Unknown");
        assert.strictEqual(info.kubernetesVersion, "1.31.1");
        assert.strictEqual(info.powerStateCode, "Unknown");
        assert.deepStrictEqual(info.supportedVersions, []);
        assert.deepStrictEqual(info.availableUpgradeVersions, []);
        assert.deepStrictEqual(info.agentPoolProfiles, [
            {
                name: "system",
                nodeImageVersion: "Unknown",
                powerStateCode: "Unknown",
                osDiskSizeGB: null,
                provisioningState: "Unknown",
                vmSize: "Unknown",
                count: null,
                osType: "Unknown",
            },
        ]);
    });

    it("normalizes null agent pool upgrade profiles before SDK deserialization", () => {
        const response = {
            properties: {
                controlPlaneProfile: { kubernetesVersion: "1.37.0" },
                agentPoolProfiles: null,
            },
        };

        normalizeUpgradeProfileResponse(response);

        assert.deepStrictEqual(response.properties.agentPoolProfiles, []);
    });

    it("normalizes omitted agent pool upgrade profiles before SDK deserialization", () => {
        const response = {
            properties: {
                controlPlaneProfile: { kubernetesVersion: "1.37.0" },
            },
        };

        normalizeUpgradeProfileResponse(response);

        assert.deepStrictEqual(response.properties, {
            controlPlaneProfile: { kubernetesVersion: "1.37.0" },
            agentPoolProfiles: [],
        });
    });

    it("preserves populated agent pool upgrade profiles", () => {
        const agentPoolProfiles = [{ name: "system", kubernetesVersion: "1.37.0", osType: "Linux" }];
        const response = { properties: { agentPoolProfiles } };

        normalizeUpgradeProfileResponse(response);

        assert.strictEqual(response.properties.agentPoolProfiles, agentPoolProfiles);
    });

    it("posts core properties when optional upgrade metadata fails", async () => {
        const responses: ReturnType<typeof asClusterInfo>[] = [];
        const errors: string[] = [];
        const webview = {
            postGetPropertiesResponse: (info: ReturnType<typeof asClusterInfo>) => {
                responses.push(info);
            },
            postPropertiesRequestComplete: () => undefined,
            postClusterOperationResponse: () => undefined,
            postErrorNotification: (error: string) => {
                errors.push(error);
            },
            postUpgradeClusterVersionResponse: () => undefined,
        } satisfies MessageSink<ToWebViewMsgDef>;

        await postClusterProperties(
            webview,
            cluster,
            async () => {
                return { succeeded: false, error: "version lookup failed" };
            },
            async () => {
                return { succeeded: false, error: "upgrade lookup failed" };
            },
        );

        assert.strictEqual(responses.length, 1);
        assert.strictEqual(errors.length, 1);
        assert.match(errors[0], /version lookup failed/);
        assert.match(errors[0], /upgrade lookup failed/);
    });

    it("posts the available enrichment when one optional lookup fails", async () => {
        const responses: ReturnType<typeof asClusterInfo>[] = [];
        const errors: string[] = [];
        const webview = {
            postGetPropertiesResponse: (info: ReturnType<typeof asClusterInfo>) => {
                responses.push(info);
            },
            postPropertiesRequestComplete: () => undefined,
            postClusterOperationResponse: () => undefined,
            postErrorNotification: (error: string) => {
                errors.push(error);
            },
            postUpgradeClusterVersionResponse: () => undefined,
        } satisfies MessageSink<ToWebViewMsgDef>;

        await postClusterProperties(
            webview,
            cluster,
            async () => ({
                succeeded: true,
                result: { values: [{ version: "1.31", patchVersions: { "1.31.1": {} } }] },
            }),
            async () => ({ succeeded: false, error: "upgrade lookup failed" }),
        );

        assert.strictEqual(responses.length, 1);
        assert.deepStrictEqual(responses[0].supportedVersions[0].patchVersions, ["1.31.1"]);
        assert.deepStrictEqual(responses[0].availableUpgradeVersions, []);
        assert.strictEqual(errors.length, 1);
    });
});
