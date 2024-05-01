import { MessageHandler, MessageSink } from "../../../../src/webview-contract/messaging";
import {
    CreateParams,
    ExistingFiles,
    InitialSelection,
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../../../src/webview-contract/webviewDefinitions/draft/draftDeployment";
import {
    AcrKey,
    ClusterKey,
    DeploymentSpecType,
    RepositoryKey,
    SubscriptionKey,
} from "../../../../src/webview-contract/webviewDefinitions/draft/types";
import { OpenFileOptions } from "../../../../src/webview-contract/webviewDefinitions/shared/fileSystemTypes";
import { WorkspaceFolderConfig } from "../../../../src/webview-contract/webviewDefinitions/shared/workspaceTypes";
import { DraftDeployment } from "../../Draft";
import { stateUpdater } from "../../Draft/DraftDeployment/state";
import { Scenario } from "../../utilities/manualTest";
import { delay } from "../../utilities/time";
import { FilePickerWrapper } from "../components/FilePickerWrapper";
import { TestDialogEvents } from "../utilities/testDialogEvents";
import {
    File,
    Directory,
    asPathParts,
    asPathString,
    findFileSystemItem,
    fromFindOutput,
    getRelativePath,
    isDirectory,
    addFileSystemItem,
    iterate,
} from "../utilities/testFileSystemUtils";
import { getAllSubscriptionData } from "./testData/azureData";
import { aksStoreDemoFiles } from "./testData/fileSystemData";

const workspaceConfig: WorkspaceFolderConfig = {
    fullPath: "/code/aks-store-demo",
    name: "aks-store-demo",
    pathSeparator: "/",
};

const rootDir = fromFindOutput(aksStoreDemoFiles, workspaceConfig.fullPath);

const allSubscriptionData = getAllSubscriptionData();

const fileStructureLookup: { [key in DeploymentSpecType]: Directory } = {
    manifests: fromFindOutput(
        `
d ./manifests
f ./manifests/deployment.yaml
f ./manifests/service.yaml
`,
        "/",
    ),
    kustomize: fromFindOutput(
        `
d ./base
f ./base/deployment.yaml
f ./base/kustomization.yaml
f ./base/namespace.yaml
f ./base/service.yaml
d ./overlays
d ./overlays/production
f ./overlays/production/deployment.yaml
f ./overlays/production/kustomization.yaml
f ./overlays/production/service.yaml
`,
        "/",
    ),
    helm: fromFindOutput(
        `
d ./charts
d ./charts/templates
f ./charts/templates/_helpers.tpl
f ./charts/templates/deployment.yaml
f ./charts/templates/namespace.yaml
f ./charts/templates/service.yaml
f ./charts/.helmignore
f ./charts/Chart.yaml
f ./charts/production.yaml
f ./charts/values.yaml
`,
        "/",
    ),
};

function createInitialState(initialSelection: InitialSelection): InitialState {
    return {
        initialSelection,
        workspaceConfig,
        location: getRelativePath(asPathString(rootDir), "/code/aks-store-demo"),
        existingFiles: getExistingFiles(rootDir, "/code/aks-store-demo"),
    };
}

export function getDraftDeploymentScenarios() {
    function getMessageHandler(
        webview: MessageSink<ToWebViewMsgDef>,
        dialogEvents: TestDialogEvents,
    ): MessageHandler<ToVsCodeMsgDef> {
        return {
            pickLocationRequest: handlePickLocationRequest,
            getSubscriptionsRequest: handleGetSubscriptionsRequest,
            getAcrsRequest: handleGetAcrsRequest,
            getRepositoriesRequest: handleGetRepositoriesRequest,
            getRepoTagsRequest: handleGetRepoTagsRequest,
            getClustersRequest: handleGetClustersRequest,
            getNamespacesRequest: handleGetNamespacesRequest,
            createDeploymentRequest: handleCreateDeploymentRequest,
            openFileRequest: handleOpenFileRequest,
            launchDraftWorkflow: (args) =>
                alert(`Launching Draft Workflow command with initial selection:\n${JSON.stringify(args, null, 2)}`),
        };

        async function handlePickLocationRequest(options: OpenFileOptions) {
            const result = await dialogEvents.openFile(options);
            if (result) {
                webview.postPickLocationResponse({
                    location: getRelativePath(asPathString(rootDir), result.paths[0]),
                    existingFiles: getExistingFiles(rootDir, result.paths[0]),
                });
            }
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

        async function handleGetRepoTagsRequest(repoKey: RepositoryKey) {
            await delay(2000);
            const subData = allSubscriptionData.find((d) => d.subscription.id === repoKey.subscriptionId);
            const groupData = subData?.resourceGroups.find((g) => g.group === repoKey.resourceGroup);
            const acrData = groupData?.acrs.find((a) => a.acr === repoKey.acrName);
            const repoData = acrData?.repositories.find((r) => r.repository === repoKey.repositoryName);
            const tags = repoData?.tags || [];
            webview.postGetRepoTagsResponse({
                ...repoKey,
                tags,
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

        async function handleCreateDeploymentRequest(createParams: CreateParams) {
            await delay(500);
            alert(`Creating Deployment with params:\n${JSON.stringify(createParams, null, 2)}`);
            const locationPath = [...rootDir.path, rootDir.name, ...asPathParts(createParams.location)];
            const fileStructure = fileStructureLookup[createParams.deploymentSpecType];
            iterate(fileStructure, (item) => {
                addFileSystemItem(rootDir, [...locationPath, ...item.path, item.name], item.type);
            });

            webview.postCreateDeploymentResponse(getExistingFiles(rootDir, locationPath.join("/")));
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
            targetPort: 3333,
            subscriptionId: allSubscriptionData[0].subscription.id,
            clusterResourceGroup: allSubscriptionData[0].resourceGroups[0].group,
            clusterName: allSubscriptionData[0].resourceGroups[0].clusters[0].cluster,
        };
    }

    function createScenario(name: string, getInitialSelection: () => InitialSelection) {
        const initialSelection = getInitialSelection();
        const initialState = createInitialState(initialSelection);
        return Scenario.create(
            "draftDeployment",
            name,
            () => (
                <FilePickerWrapper events={dialogEvents} rootDir={rootDir}>
                    <DraftDeployment {...initialState} />
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

function getExistingFiles(workspaceDirectory: Directory, locationFullPath: string): ExistingFiles {
    return {
        manifests: getExistingFilesRelativeToWorkspace(fileStructureLookup["manifests"]).map(toRelativePath),
        kustomize: getExistingFilesRelativeToWorkspace(fileStructureLookup["kustomize"]).map(toRelativePath),
        helm: getExistingFilesRelativeToWorkspace(fileStructureLookup["helm"]).map(toRelativePath),
    };

    function getExistingFilesRelativeToWorkspace(fileStructure: Directory): File[] {
        const dirPathParts = asPathParts(locationFullPath);
        const result: File[] = [];
        iterate(fileStructure, (item) => {
            const found = findFileSystemItem(workspaceDirectory, [...dirPathParts, ...item.path, item.name]);
            if (found && !isDirectory(found)) {
                result.push(found);
            }
        });
        return result;
    }

    function toRelativePath(file: File): string {
        return getRelativePath(asPathString(workspaceDirectory), asPathString(file));
    }
}
