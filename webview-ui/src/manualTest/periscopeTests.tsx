import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import {
    InitialState,
    ToVsCodeMsgDef,
    ToWebViewMsgDef,
} from "../../../src/webview-contract/webviewDefinitions/periscope";
import { Scenario } from "../utilities/manualTest";
import { Periscope } from "../Periscope/Periscope";
import { stateUpdater } from "../Periscope/state";

export function getPeriscopeScenarios() {
    const clusterName = "test-cluster";
    const noDiagnosticsState: InitialState = {
        state: "noDiagnosticsConfigured",
        clusterName,
        runId: "",
        nodes: [],
        message: "",
        kustomizeConfig: null,
        blobContainerUrl: "",
        shareableSas: "",
    };

    const testNodes = ["test-node-001", "test-node-002", "test-node-003"];
    const startDate = new Date();
    const runId = `${startDate.toISOString().slice(0, 19).replace(/:/g, "-")}Z`;
    const kustomizeConfig = {
        containerRegistry: "mcr.microsoft.com",
        imageVersion: "999.9.9",
        releaseTag: "v999.9.9",
        repoOrg: "azure",
    };
    const blobContainerUrl = `https://teststgaccount.net/${clusterName}-logs`;
    const shareableSas = "?saskey";

    const errorState: InitialState = {
        state: "error",
        clusterName,
        runId,
        nodes: testNodes,
        message: "Something went wrong.\nThis is a description of the problem.",
        kustomizeConfig,
        blobContainerUrl,
        shareableSas,
    };

    const successState: InitialState = {
        state: "success",
        clusterName,
        runId,
        nodes: testNodes,
        message: "",
        kustomizeConfig: null,
        blobContainerUrl,
        shareableSas,
    };

    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>): MessageHandler<ToVsCodeMsgDef> {
        const startTime = Date.now();
        return {
            async nodeLogsRequest(args) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                webview.postNodeLogsResponse({
                    nodeName: args.nodeName,
                    logs: ["aks-periscope-pod", "diag-collector-pod"].map((podName) => ({
                        podName,
                        logs: Array.from(
                            { length: Math.floor(Math.random() * 500) },
                            (_, i) => `${new Date(startDate.getTime() + i * 200).toISOString()} Doing thing ${i + 1}`,
                        ).join("\n"),
                    })),
                });
            },
            uploadStatusRequest() {
                const secondsSinceStart = (Date.now() - startTime) / 1000;
                webview.postUploadStatusResponse({
                    uploadStatuses: testNodes.map((n, nodeIndex) => ({
                        nodeName: n,
                        isUploaded: secondsSinceStart >= nodeIndex * 10 + 5,
                    })),
                });
            },
        };
    }

    return [
        Scenario.create(
            "periscope",
            "no diagnostics",
            () => <Periscope {...noDiagnosticsState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
        Scenario.create(
            "periscope",
            "error",
            () => <Periscope {...errorState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
        Scenario.create(
            "periscope",
            "deployed",
            () => <Periscope {...successState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
    ];
}
