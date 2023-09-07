import { MessageHandler } from "../../../src/webview-contract/messaging";
import { PeriscopeTypes } from "../../../src/webview-contract/webviewTypes";
import { Scenario } from "../utilities/manualTest";
import { getTestVscodeMessageContext } from "../utilities/vscode";
import { Periscope } from "../Periscope/Periscope";

export function getPeriscopeScenarios() {
    const clusterName = "test-cluster";
    const noDiagnosticsState: PeriscopeTypes.InitialState = {
        state: "noDiagnosticsConfigured",
        clusterName,
        runId: "",
        nodes: [],
        message: "",
        kustomizeConfig: null,
        blobContainerUrl: "",
        shareableSas: ""
    }

    const testNodes = ["test-node-001", "test-node-002", "test-node-003"];
    const startDate = new Date();
    const runId = startDate.toISOString().slice(0, 19).replace(/:/g, '-') + 'Z';
    const kustomizeConfig = {
        containerRegistry: "mcr.microsoft.com",
        imageVersion: "999.9.9",
        releaseTag: "v999.9.9",
        repoOrg: "azure"
    };
    const blobContainerUrl = `https://teststgaccount.net/${clusterName}-logs`;
    const shareableSas = "?saskey";

    const errorState: PeriscopeTypes.InitialState = {
        state: "error",
        clusterName,
        runId,
        nodes: testNodes,
        message: "Something went wrong.\nThis is a description of the problem.",
        kustomizeConfig,
        blobContainerUrl,
        shareableSas
    }

    const successState: PeriscopeTypes.InitialState = {
        state: "success",
        clusterName,
        runId,
        nodes: testNodes,
        message: "",
        kustomizeConfig: null,
        blobContainerUrl,
        shareableSas
    };

    const webview = getTestVscodeMessageContext<PeriscopeTypes.ToWebViewMsgDef, PeriscopeTypes.ToVsCodeMsgDef>();
    const messageHandler: MessageHandler<PeriscopeTypes.ToVsCodeMsgDef> = {
        nodeLogsRequest: args => handleNodeLogsRequest(args.nodeName),
        uploadStatusRequest: handleUploadStatusRequest
    };

    let uploadStatusCallCount = 0;
    function handleUploadStatusRequest() {
        uploadStatusCallCount += 1;
        webview.postMessage({
            command: "uploadStatusResponse",
            parameters: {
                uploadStatuses: testNodes.map((n, nodeIndex) => ({
                    nodeName: n,
                    isUploaded: uploadStatusCallCount >= (nodeIndex * 3)
                }))
            }
        });
    }

    async function handleNodeLogsRequest(nodeName: string): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, 1000));
        webview.postMessage({
            command: "nodeLogsResponse",
            parameters: {
                nodeName,
                logs: ["aks-periscope-pod", "diag-collector-pod"].map(podName => ({
                    podName,
                    logs: Array.from({ length: Math.floor(Math.random() * 500) }, (_, i) => `${new Date(startDate.getTime() + i * 200).toISOString()} Doing thing ${i + 1}`).join('\n')
                }))
            }
        })
    }

    return [
        Scenario.create(`${PeriscopeTypes.contentId} (no diagnostics)`, () => <Periscope {...noDiagnosticsState} />),
        Scenario.create(`${PeriscopeTypes.contentId} (error)`, () => <Periscope {...errorState} />),
        Scenario.create(`${PeriscopeTypes.contentId} (deployed)`, () => <Periscope {...successState} />).withSubscription(webview, messageHandler)
    ]
}
