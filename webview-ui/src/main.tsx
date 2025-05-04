import "@vscode/codicons/dist/codicon.css";
import { JSX, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { decodeState } from "../../src/webview-contract/initialState";
import { ContentId } from "../../src/webview-contract/webviewTypes";
import { AttachAcrToCluster } from "./AttachAcrToCluster/AttachAcrToCluster";
import { AzureServiceOperator } from "./AzureServiceOperator/AzureServiceOperator";
import { ClusterProperties } from "./ClusterProperties/ClusterProperties";
import { CreateCluster } from "./CreateCluster/CreateCluster";
import { Detector } from "./Detector/Detector";
import { DraftDeployment, DraftDockerfile, DraftWorkflow, DraftValidate } from "./Draft";
import { InspektorGadget } from "./InspektorGadget/InspektorGadget";
import { Kaito } from "./Kaito/Kaito";
import { KaitoModels } from "./KaitoModels/KaitoModels";
import { KaitoManage } from "./KaitoManage/KaitoManage";
import { KaitoTest } from "./KaitoTest/KaitoTest";
import { Kubectl } from "./Kubectl/Kubectl";
import "./main.css";
import { Periscope } from "./Periscope/Periscope";
import { RetinaCapture } from "./RetinaCapture/RetinaCapture";
import { TcpDump } from "./TCPDump/TcpDump";
import { TestStyleViewer } from "./TestStyleViewer/TestStyleViewer";
import { AutomatedDeployments } from "./AutomatedDeployments/AutomatedDeployments";
import { CreateFleet } from "./CreateFleet/CreateFleet";
import { FleetProperties } from "./FleetProperties/FleetProperties";
import { Headlamp } from "./Headlamp/Headlamp";

// There are two modes of launching this application:
// 1. Via the VS Code extension inside a Webview.
// 2. In a browser using a local web server.
//
// This entrypoint is for the VS Code extension:
// - Content selection: the extension will specify the content using a 'data-contentid' attribute on the root element.
// - Initial state: the extension will specify initial state as a JSON-serialized value in the 'data-initialstate'
//   attribute on the root element.
// - Message passing: the extension will handle outgoing messages from React components (sent using `vscode.postMessage`)
//   and will respond using `Webview.postMessage`.

const rootElem = document.getElementById("root");
const root = createRoot(rootElem!);

function getVsCodeContent(): JSX.Element {
    if (!rootElem) {
        return <>Error: Element with ID &#39;root&#39; is not found.</>;
    }
    const vscodeContentId = rootElem?.dataset.contentid as ContentId;
    if (!vscodeContentId) {
        return <>Error: &#39;content-id&#39; attribute is not set on root element.</>;
    }

    function getInitialState<T>(): T {
        return decodeState<T>(rootElem?.dataset.initialstate);
    }

    const rendererLookup: Record<ContentId, () => JSX.Element> = {
        createCluster: () => <CreateCluster {...getInitialState()} />,
        style: () => <TestStyleViewer {...getInitialState()} />,
        attachAcrToCluster: () => <AttachAcrToCluster {...getInitialState()} />,
        clusterProperties: () => <ClusterProperties {...getInitialState()} />,
        periscope: () => <Periscope {...getInitialState()} />,
        detector: () => <Detector {...getInitialState()} />,
        draftDeployment: () => <DraftDeployment {...getInitialState()} />,
        draftDockerfile: () => <DraftDockerfile {...getInitialState()} />,
        draftWorkflow: () => <DraftWorkflow {...getInitialState()} />,
        draftValidate: () => <DraftValidate {...getInitialState()} />,
        gadget: () => <InspektorGadget {...getInitialState()} />,
        kubectl: () => <Kubectl {...getInitialState()} />,
        aso: () => <AzureServiceOperator {...getInitialState()} />,
        tcpDump: () => <TcpDump {...getInitialState()} />,
        retinaCapture: () => <RetinaCapture {...getInitialState()} />,
        kaito: () => <Kaito {...getInitialState()} />,
        kaitoModels: () => <KaitoModels {...getInitialState()} />,
        kaitoManage: () => <KaitoManage {...getInitialState()} />,
        kaitoTest: () => <KaitoTest {...getInitialState()} />,
        automatedDeployments: () => <AutomatedDeployments {...getInitialState()} />,
        createFleet: () => <CreateFleet {...getInitialState()} />,
        fleetProperties: () => <FleetProperties {...getInitialState()} />,
        headlamp: () => <Headlamp {...getInitialState()} />,
    };

    return rendererLookup[vscodeContentId]();
}

root.render(<StrictMode>{getVsCodeContent()}</StrictMode>);
