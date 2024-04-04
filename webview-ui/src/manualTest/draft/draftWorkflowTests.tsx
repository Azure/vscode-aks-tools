import { MessageHandler, MessageSink } from "../../../../src/webview-contract/messaging";
import {
    InitialState,
    PickFilesIdentifier,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../../../src/webview-contract/webviewDefinitions/draft/draftWorkflow";
import {
    AcrKey,
    ClusterKey,
    ForkKey,
    PickFilesRequestParams,
    SubscriptionKey,
} from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import { WorkspaceFolderConfig } from "../../../../src/webview-contract/webviewDefinitions/shared/workspaceTypes";
import { DraftWorkflow } from "../../Draft";
import { stateUpdater } from "../../Draft/DraftWorkflow/state";
import { Scenario } from "../../utilities/manualTest";
import { delay } from "../../utilities/time";
import {
    Directory,
    FileOrDirectory,
    addFileSystemItem,
    asPathParts,
    asPathString,
    findFileSystemItem,
    fromFindOutput,
    getRelativePath,
    isDirectory,
} from "../utilities/testFileSystemUtils";
import { getAllSubscriptionData } from "./testData/azureData";
import { aksStoreDemoFiles } from "./testData/fileSystemData";
import { getAllForkData } from "./testData/gitHubData";
import { FilePickerWrapper } from "../components/FilePickerWrapper";
import { TestDialogEvents } from "../utilities/testDialogEvents";
import { CreateParams } from "../../../../src/webview-contract/webviewDefinitions/draft/draftWorkflow";

const workspaceConfig: WorkspaceFolderConfig = {
    fullPath: "/code/aks-store-demo",
    name: "aks-store-demo",
    pathSeparator: "/",
};

const rootDir = fromFindOutput(aksStoreDemoFiles, workspaceConfig.fullPath);
const workflowsDir = findFileSystemItem(rootDir, asPathParts("/code/aks-store-demo/.github/workflows")) as Directory;
const existingWorkflowFiles = workflowsDir.contents.filter(isWorkflowFile).map((item) => ({
    name: item.name.substring(0, item.name.lastIndexOf(".")),
    path: getRelativePath(asPathString(rootDir), asPathString(item)),
}));

const allSubscriptionData = getAllSubscriptionData();
const allForkData = getAllForkData();

function isWorkflowFile(item: FileOrDirectory): boolean {
    if (isDirectory(item)) {
        return false;
    }

    return item.name.endsWith(".yml") || item.name.endsWith(".yaml");
}

export function getDraftWorkflowScenarios() {
    const initialState: InitialState = {
        workspaceConfig,
        existingWorkflowFiles,
        forks: allForkData.map((f) => ({
            name: f.name,
            url: `https://github.com/${f.owner}/${f.name}.git`,
            owner: f.owner,
            repo: f.repo,
            isFork: f.isFork,
            defaultBranch: f.defaultBranch,
        })),
    };

    function getMessageHandler(
        webview: MessageSink<ToWebViewMsgDef>,
        dialogEvents: TestDialogEvents,
    ): MessageHandler<ToVsCodeMsgDef> {
        return {
            pickFilesRequest: handlePickFilesRequest,
            getBranchesRequest: handleGetBranchesRequest,
            getSubscriptionsRequest: handleGetSubscriptionsRequest,
            getAcrsRequest: handleGetAcrsRequest,
            getRepositoriesRequest: handleGetRepositoriesRequest,
            getClustersRequest: handleGetClustersRequest,
            getNamespacesRequest: handleGetNamespacesRequest,
            createWorkflowRequest: handleCreateWorkflowRequest,
            openFileRequest: handleOpenFileRequest,
        };

        async function handlePickFilesRequest(params: PickFilesRequestParams<PickFilesIdentifier>) {
            const result = await dialogEvents.openFile(params.options);
            if (result) {
                webview.postPickFilesResponse({
                    identifier: params.identifier,
                    paths: result.paths.map((p) => getRelativePath(asPathString(rootDir), p)) as [string, ...string[]],
                });
            }
        }

        async function handleGetBranchesRequest(forkKey: ForkKey) {
            await delay(2000);
            const forkData = allForkData.find((f) => f.name === forkKey.forkName);
            const branches = forkData?.branches || [];
            webview.postGetBranchesResponse({
                ...forkKey,
                branches,
            });
        }

        async function handleGetSubscriptionsRequest() {
            await delay(2000);
            const subscriptions = allSubscriptionData.map((d) => d.subscription);
            webview.postGetSubscriptionsResponse(subscriptions);
        }

        async function handleGetAcrsRequest(subscriptionKey: SubscriptionKey) {
            await delay(2000);
            const subData = allSubscriptionData.find((d) => d.subscription.id === subscriptionKey.subscriptionId);
            const acrKeys: AcrKey[] =
                subData?.resourceGroups?.flatMap((g) =>
                    g.acrs.map((acr) => ({
                        ...subscriptionKey,
                        resourceGroup: g.group,
                        acrName: acr.acr,
                    })),
                ) || [];

            webview.postGetAcrsResponse({ ...subscriptionKey, acrKeys });
        }

        async function handleGetRepositoriesRequest(acrKey: AcrKey) {
            await delay(2000);
            const subData = allSubscriptionData.find((d) => d.subscription.id === acrKey.subscriptionId);
            const groupData = subData?.resourceGroups.find((g) => g.group === acrKey.resourceGroup);
            const acrData = groupData?.acrs.find((a) => a.acr === acrKey.acrName);
            const repos = acrData?.repositories || [];
            webview.postGetRepositoriesResponse({
                ...acrKey,
                repositoryNames: repos.map((r) => r.repository),
            });
        }

        async function handleGetClustersRequest(subscriptionKey: SubscriptionKey) {
            await delay(2000);
            const subData = allSubscriptionData.find((d) => d.subscription.id === subscriptionKey.subscriptionId);
            const clusterKeys: ClusterKey[] =
                subData?.resourceGroups?.flatMap((g) =>
                    g.clusters.map((cluster) => ({
                        ...subscriptionKey,
                        resourceGroup: g.group,
                        clusterName: cluster.cluster,
                    })),
                ) || [];

            webview.postGetClustersResponse({ ...subscriptionKey, clusterKeys });
        }

        async function handleGetNamespacesRequest(clusterKey: ClusterKey) {
            await delay(2000);
            const subData = allSubscriptionData.find((d) => d.subscription.id === clusterKey.subscriptionId);
            const groupData = subData?.resourceGroups.find((g) => g.group === clusterKey.resourceGroup);
            const clusterData = groupData?.clusters.find((c) => c.cluster === clusterKey.clusterName);
            const namespaces = clusterData?.namespaces || [];
            webview.postGetNamespacesResponse({
                ...clusterKey,
                namespaceNames: namespaces,
            });
        }

        async function handleCreateWorkflowRequest(createParams: CreateParams) {
            await delay(500);
            alert(`Creating Workflow with params:\n${JSON.stringify(createParams, null, 2)}`);
            addFileSystemItem(rootDir, [...rootDir.path, rootDir.name, ".github"], "directory");
            addFileSystemItem(rootDir, [...rootDir.path, rootDir.name, ".github", "workflows"], "directory");
            addFileSystemItem(
                rootDir,
                [...rootDir.path, rootDir.name, ".github", "workflows", `${createParams.workflowName}.yaml`],
                "file",
            );
            webview.postCreateWorkflowResponse({
                name: createParams.workflowName,
                path: `.github/workflows/${createParams.workflowName}.yaml`,
            });
        }

        function handleOpenFileRequest(relativePath: string) {
            alert(`Opening ${relativePath}`);
        }
    }

    const dialogEvents = new TestDialogEvents();
    return [
        Scenario.create(
            "draftWorkflow",
            "",
            () => (
                <FilePickerWrapper events={dialogEvents} rootDir={rootDir}>
                    <DraftWorkflow {...initialState} />
                </FilePickerWrapper>
            ),
            (webview) => getMessageHandler(webview, dialogEvents),
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}
