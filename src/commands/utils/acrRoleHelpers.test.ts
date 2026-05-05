import * as assert from "assert";
import * as sinon from "sinon";
import * as roleAssignments from "./roleAssignments";
import * as arm from "./arm";
import { principalHasAcrPullForAcr } from "./acrRoleHelpers";
import { AcrKey } from "../../webview-contract/webviewDefinitions/attachAcrToCluster";
import { AuthorizationManagementClient } from "@azure/arm-authorization";

describe("principalHasAcrPullForAcr", () => {
    let sandbox: sinon.SinonSandbox;
    let getPrincipalRoleAssignmentsStub: sinon.SinonStub;
    let getAuthorizationManagementClientStub: sinon.SinonStub;
    let fakeClient: Partial<AuthorizationManagementClient>;

    const acrKey: AcrKey = {
        subscriptionId: "sub-acr",
        resourceGroup: "rg-acr",
        acrName: "myacr",
    };

    const principalId = "principal-123";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sessionProvider: any = {};

    beforeEach(() => {
        sandbox = sinon.createSandbox();
        fakeClient = {};
        getAuthorizationManagementClientStub = sandbox
            .stub(arm, "getAuthorizationManagementClient")
            .returns(fakeClient as AuthorizationManagementClient);
        getPrincipalRoleAssignmentsStub = sandbox.stub(roleAssignments, "getPrincipalRoleAssignmentsForAcr");
    });

    afterEach(() => {
        sandbox.restore();
    });

    it("returns {succeeded: true, result: true} when principal has AcrPull role", async () => {
        const acrPullRoleId =
            "/subscriptions/sub-acr/providers/Microsoft.Authorization/roleDefinitions/7f951dda-4ed3-4680-a7ca-43fe172d538d";
        getPrincipalRoleAssignmentsStub.resolves({
            succeeded: true,
            result: [{ roleDefinitionId: acrPullRoleId }],
        });

        const result = await principalHasAcrPullForAcr(sessionProvider, principalId, acrKey);

        assert.deepStrictEqual(result, { succeeded: true, result: true });
    });

    it("returns {succeeded: true, result: false} when principal does not have AcrPull role", async () => {
        const otherRoleId =
            "/subscriptions/sub-acr/providers/Microsoft.Authorization/roleDefinitions/acdd72a7-3385-48ef-bd42-f606fba81ae7";
        getPrincipalRoleAssignmentsStub.resolves({
            succeeded: true,
            result: [{ roleDefinitionId: otherRoleId }],
        });

        const result = await principalHasAcrPullForAcr(sessionProvider, principalId, acrKey);

        assert.deepStrictEqual(result, { succeeded: true, result: false });
    });

    it("uses ACR subscription (not cluster subscription) when calling getAuthorizationManagementClient", async () => {
        // ACR is in sub-A, cluster principal is in sub-B — auth client must use ACR's sub
        const acrKeyInSubA: AcrKey = {
            subscriptionId: "sub-A",
            resourceGroup: "rg-acr",
            acrName: "myacr",
        };

        getPrincipalRoleAssignmentsStub.resolves({ succeeded: true, result: [] });

        await principalHasAcrPullForAcr(sessionProvider, principalId, acrKeyInSubA);

        sinon.assert.calledOnce(getAuthorizationManagementClientStub);
        sinon.assert.calledWith(getAuthorizationManagementClientStub, sessionProvider, "sub-A");
    });
});
