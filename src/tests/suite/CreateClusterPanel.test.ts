import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ContainerServiceClient } from "@azure/arm-containerservice";
import { ResourceManagementClient } from "@azure/arm-resources";
import { TelemetryReporter } from "@vscode/extension-telemetry";
import { ReadyAzureSessionProvider } from "../../auth/types";
import * as arm from "../../commands/utils/arm";
import * as config from "../../commands/utils/config";
import * as clusterfilter from "../../commands/utils/clusterfilter";
import * as telemetry from "../../commands/utils/reporter";
import { CreateClusterDataProvider } from "../../panels/CreateClusterPanel";
import { MessageSink } from "../../webview-contract/messaging";
import {
    CreateClusterParams,
    PresetType,
    ProgressEventType,
    ToWebViewMsgDef,
} from "../../webview-contract/webviewDefinitions/createCluster";

describe("Create cluster panel", () => {
    const parameters: CreateClusterParams = {
        isNewResourceGroup: false,
        resourceGroupName: "rg",
        location: "westus3",
        name: "cluster",
        preset: PresetType.Dev,
    };

    type DeploymentPoller = Awaited<ReturnType<ResourceManagementClient["resources"]["beginCreateOrUpdateById"]>>;

    function createPoller(status: ReturnType<DeploymentPoller["getOperationState"]>["status"]): DeploymentPoller {
        const state = { status, error: status === "failed" ? new Error("Deployment failed") : undefined };
        return {
            isDone: () => status !== "running",
            getOperationState: () => state,
            getResult: () => ({}),
            poll: async () => state,
            pollUntilDone: async () => {
                if (state.error) throw state.error;
                return {};
            },
            onProgress: () => () => undefined,
            serialize: async () => "",
            submitted: async () => undefined,
            toString: () => "",
            stopPolling: () => undefined,
            isStopped: () => false,
        };
    }

    function setup() {
        const credential = { getToken: async () => null };
        const aksClient = new ContainerServiceClient(credential, "subscription");
        const resourcesClient = new ResourceManagementClient(credential, "subscription");
        sinon.stub(arm, "getAksClient").returns(aksClient);
        sinon.stub(arm, "getResourceManagementClient").returns(resourcesClient);
        const versions = sinon.stub(aksClient.managedClusters, "listKubernetesVersions");
        versions.resolves({ values: [{ version: "1.31", isDefault: true }] });
        const submit = sinon.stub(resourcesClient.resources, "beginCreateOrUpdateById");
        const createGroup = sinon.stub(resourcesClient.resourceGroups, "createOrUpdate");
        const getAuthSession = sinon.stub().resolves({
            succeeded: true,
            result: {
                account: { id: "tenant/user", label: "test-user" },
            },
        });
        const sessionProvider: ReadyAzureSessionProvider = {
            signIn: async () => undefined,
            signInStatus: "SignedIn",
            availableTenants: [],
            selectedTenant: { id: "tenant", name: "tenant", countryCode: "US" },
            signInStatusChangeEvent: () => new vscode.Disposable(() => undefined),
            getAuthSession,
            dispose: () => undefined,
        };
        const updates: ToWebViewMsgDef["progressUpdate"][] = [];
        const webview: MessageSink<ToWebViewMsgDef> = {
            postGetLocationsResponse: () => undefined,
            postGetResourceGroupsResponse: () => undefined,
            postProgressUpdate: (update) => updates.push(update),
            postMergeKubeconfigResponse: () => undefined,
        };
        const showError = sinon.stub(vscode.window, "showErrorMessage");
        sinon.stub(vscode.window, "showInformationMessage");
        sinon.stub(vscode.window, "showWarningMessage");
        sinon.stub(telemetry, "reporter").value(sinon.createStubInstance(TelemetryReporter));
        const filteredClusters = sinon
            .stub(config, "getFilteredClusters")
            .returns([{ subscriptionId: "subscription", clusterName: "existing-cluster" }]);
        const updateFilter = sinon.stub(clusterfilter, "addItemToClusterFilter").resolves();
        const refreshTree = sinon.stub();
        const provider = new CreateClusterDataProvider(
            sessionProvider,
            "subscription",
            "Test subscription",
            refreshTree,
            "aks.createCluster",
        );
        const handler = provider.getMessageHandler(webview);
        return {
            versions,
            submit,
            createGroup,
            getAuthSession,
            updates,
            showError,
            handler,
            filteredClusters,
            updateFilter,
            refreshTree,
            sessionProvider,
        };
    }

    afterEach(() => sinon.restore());

    it("preserves resource-group creation errors and does not start cluster creation", async () => {
        const { createGroup, versions, submit, updates, handler, updateFilter } = setup();
        createGroup.rejects(new Error("Resource-group creation failed"));

        await handler.createClusterRequest({ ...parameters, isNewResourceGroup: true }, "createClusterRequest");

        const update = updates.at(-1);
        assert.strictEqual(update?.event, ProgressEventType.Failed);
        assert.strictEqual(update.errorMessage, "Resource-group creation failed");
        assert.ok(versions.notCalled);
        assert.ok(submit.notCalled);
        assert.ok(updateFilter.notCalled);
    });

    for (const step of ["versions", "authentication"] as const) {
        it(`ends the spinner when ${step} throws before submission`, async () => {
            const { versions, getAuthSession, submit, updates, showError, handler, updateFilter } = setup();
            const failure = new Error(`${step} request failed`);
            (step === "versions" ? versions : getAuthSession).rejects(failure);

            await handler.createClusterRequest(parameters, "createClusterRequest");

            const update = updates.at(-1);
            assert.strictEqual(update?.event, ProgressEventType.Failed);
            assert.strictEqual(update.errorMessage, failure.message);
            assert.strictEqual(update.deploymentPortalUrl, null);
            assert.ok(showError.calledOnce);
            assert.ok(submit.notCalled);
            assert.ok(updateFilter.notCalled);
        });
    }

    it("shows the deployment link while submission is pending and preserves it on rejection", async () => {
        const { submit, updates, handler, updateFilter } = setup();
        let rejectSubmission: (reason: Error) => void = () => assert.fail("Submission was not started");
        submit.callsFake(
            () =>
                new Promise((_resolve, reject) => {
                    rejectSubmission = reject;
                }),
        );

        const creation = handler.createClusterRequest(parameters, "createClusterRequest");
        await new Promise<void>((resolve) => setImmediate(resolve));

        assert.ok(submit.calledOnce);
        const pending = updates.at(-1);
        assert.strictEqual(pending?.event, ProgressEventType.InProgress);
        assert.ok(pending.deploymentPortalUrl?.includes("DeploymentDetailsBlade"));
        assert.ok(updateFilter.notCalled);

        rejectSubmission(new Error("Deployment submission failed"));
        await creation;

        const failed = updates.at(-1);
        assert.strictEqual(failed?.event, ProgressEventType.Failed);
        assert.strictEqual(failed.errorMessage, "Deployment submission failed");
        assert.strictEqual(failed.deploymentPortalUrl, pending.deploymentPortalUrl);
        assert.ok(updateFilter.notCalled);
    });

    for (const step of ["no-versions", "no-session", "no-principal"] as const) {
        it(`leaves the active filter unchanged when preparation returns ${step}`, async () => {
            const { versions, getAuthSession, submit, updates, handler, updateFilter } = setup();
            if (step === "no-versions") {
                versions.resolves({ values: [] });
            } else if (step === "no-session") {
                getAuthSession.resolves({ succeeded: false, error: "No authentication session" });
            } else {
                getAuthSession.resolves({ succeeded: true, result: { account: { id: "", label: "test-user" } } });
            }

            await handler.createClusterRequest({ ...parameters, preset: PresetType.Automatic }, "createClusterRequest");

            assert.strictEqual(updates.at(-1)?.event, ProgressEventType.Failed);
            assert.ok(submit.notCalled);
            assert.ok(updateFilter.notCalled);
        });
    }

    for (const status of ["failed", "canceled", "running"] as const) {
        it(`does not update the active filter when the deployment reports ${status}`, async () => {
            const { submit, updates, handler, updateFilter, refreshTree } = setup();
            submit.resolves(createPoller(status));

            await handler.createClusterRequest(parameters, "createClusterRequest");

            const expectedEvent =
                status === "failed"
                    ? ProgressEventType.Failed
                    : status === "canceled"
                      ? ProgressEventType.Cancelled
                      : ProgressEventType.TrackingLost;
            assert.strictEqual(updates.at(-1)?.event, expectedEvent);
            assert.ok(updateFilter.notCalled);
            assert.ok(refreshTree.notCalled);
        });
    }

    it("leaves the active filter unchanged when status tracking fails after retries", async () => {
        const { submit, updates, handler, updateFilter } = setup();
        const poller = createPoller("running");
        const poll = sinon.stub(poller, "pollUntilDone").rejects(new Error("Status request failed"));
        submit.resolves(poller);
        const clock = sinon.useFakeTimers({ toFake: ["setTimeout"] });

        const creation = handler.createClusterRequest(parameters, "createClusterRequest");
        await clock.tickAsync(30000);
        await creation;

        assert.strictEqual(poll.callCount, 4);
        assert.strictEqual(updates.at(-1)?.event, ProgressEventType.TrackingLost);
        assert.ok(updates.at(-1)?.deploymentPortalUrl);
        assert.ok(updateFilter.notCalled);
    });

    it("adds a successfully created cluster to the active filter", async () => {
        const { submit, updates, handler, updateFilter, refreshTree, sessionProvider } = setup();
        submit.resolves(createPoller("succeeded"));

        await handler.createClusterRequest(parameters, "createClusterRequest");

        assert.strictEqual(updates.at(-1)?.event, ProgressEventType.Success);
        assert.ok(
            updateFilter.calledOnceWithExactly("Test subscription", "subscription", parameters.name, sessionProvider),
        );
        assert.ok(refreshTree.notCalled);
    });

    it("refreshes the tree after successful creation when no filter is active", async () => {
        const { submit, handler, filteredClusters, updateFilter, refreshTree } = setup();
        filteredClusters.returns([]);
        submit.resolves(createPoller("succeeded"));

        await handler.createClusterRequest(parameters, "createClusterRequest");

        assert.ok(refreshTree.calledOnce);
        assert.ok(updateFilter.notCalled);
    });
});
