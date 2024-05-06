import { MessageHandler, MessageSink } from "../../../../src/webview-contract/messaging";
import {
    InitialSelection,
    InitialState,
    PickFilesIdentifier,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../../../src/webview-contract/webviewDefinitions/draft/draftWorkflow";
import {
    AcrKey,
    ClusterKey,
    GitHubRepoKey,
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
import { getGitHubRepoData } from "./testData/gitHubData";
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
const allGitHubRepoData = getGitHubRepoData();

function isWorkflowFile(item: FileOrDirectory): boolean {
    if (isDirectory(item)) {
        return false;
    }

    return item.name.endsWith(".yml") || item.name.endsWith(".yaml");
}

function createInitialState(initialSelection: InitialSelection): InitialState {
    return {
        initialSelection,
        workspaceConfig,
        existingWorkflowFiles,
        repos: allGitHubRepoData.map((r) => ({
            gitHubRepoOwner: r.ownerName,
            gitHubRepoName: r.repoName,
            forkName: r.forkName,
            url: `https://github.com/${r.ownerName}/${r.repoName}.git`,
            isFork: r.isFork,
            defaultBranch: r.defaultBranch,
        })),
    };
}

export function getDraftWorkflowScenarios() {
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
            launchDraftDockerfile: (args) =>
                alert(`Launching Draft Workflow command with initial selection:\n${JSON.stringify(args, null, 2)}`),
            launchDraftDeployment: (args) =>
                alert(`Launching Draft Deployment command with initial selection:\n${JSON.stringify(args, null, 2)}`),
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

        async function handleGetBranchesRequest(repoKey: GitHubRepoKey) {
            await delay(2000);
            const repoData = allGitHubRepoData.find(
                (r) => r.ownerName === repoKey.gitHubRepoOwner && r.repoName === repoKey.gitHubRepoName,
            );
            const branches = repoData?.branches || [];
            webview.postGetBranchesResponse({
                gitHubRepoOwner: repoKey.gitHubRepoOwner,
                gitHubRepoName: repoKey.gitHubRepoName,
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
            webview.postCreateWorkflowResponse([
                ...existingWorkflowFiles,
                {
                    name: createParams.workflowName,
                    path: `.github/workflows/${createParams.workflowName}.yaml`,
                },
            ]);
        }

        function handleOpenFileRequest(relativePath: string) {
            alert(`Opening ${relativePath}`);
        }
    }

    const dialogEvents = new TestDialogEvents();

    function createUnpopulatedInitialSelection(): InitialSelection {
        return {};
    }

    function createPopulatedInitialSelection(): InitialSelection {
        return {
            dockerfilePath: "src/product-service/Dockerfile",
            dockerfileBuildContextPath: "src/product-service",
            subscriptionId: allSubscriptionData[0].subscription.id,
            acrResourceGroup: allSubscriptionData[0].resourceGroups[0].group,
            acrName: allSubscriptionData[0].resourceGroups[0].acrs[0].acr,
            acrRepository: allSubscriptionData[0].resourceGroups[0].acrs[0].repositories[0].repository,
            clusterResourceGroup: allSubscriptionData[0].resourceGroups[1].group,
            clusterName: allSubscriptionData[0].resourceGroups[1].clusters[0].cluster,
            clusterNamespace: allSubscriptionData[0].resourceGroups[1].clusters[0].namespaces[0],
            deploymentSpecType: "helm",
            helmChartPath: "charts/aks-store-demo",
            helmValuesYamlPath: "charts/aks-store-demo/values.yaml",
            manifestFilePaths: ["ai-service.yaml", "aks-store-all-in-one.yaml"],
        };
    }

    function createScenario(name: string, getInitialSelection: () => InitialSelection) {
        const initialSelection = getInitialSelection();
        const initialState = createInitialState(initialSelection);
        return Scenario.create(
            "draftWorkflow",
            name,
            () => (
                <FilePickerWrapper events={dialogEvents} rootDir={rootDir}>
                    <DraftWorkflow {...initialState} />
                </FilePickerWrapper>
            ),
            (webview) => getMessageHandler(webview, dialogEvents),
            stateUpdater.vscodeMessageHandler,
        );
    }

    return [
        createScenario("blank", createUnpopulatedInitialSelection),
        createScenario("populated", createPopulatedInitialSelection),
    ];
}
