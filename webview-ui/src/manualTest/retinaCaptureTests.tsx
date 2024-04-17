import { InitialState } from "../../../src/webview-contract/webviewDefinitions/retinaCapture";
import { RetinaCapture } from "../RetinaCapture/RetinaCapture";
import { stateUpdater } from "../TestStyleViewer/state";
import { Scenario } from "../utilities/manualTest";

export function getRetinaCaptureScenarios() {

    const initialState: InitialState = {
        selectedNode: "node-1",
        clusterName: "test-cluster",
        retinaOutput: ["Microsoft open sources Retina: A cloud-native container networking observability platform. The Microsoft Azure Container Networking team is excited to announce Retina, a cloud - native container networking observability platform that enables Kubernetes users, admins, and developers to visualize, observe, debug, and analyze Kubernetes’ workload traffic irrespective of Container Network Interface(CNI), operating system(OS), and cloud.We are excited to release Retina as an open - source repository that helps with DevOps and SecOps related networking cases for your Kubernetes clusters and we invite the open- source community to innovate along with us."],
        allNodes: ["aks-nodepool2-30344018-vmss000000", "aks-nodepool2-30344018-vmss000001", "aks-nodepool2-30344018-vmss000003"],
        captureFolderName: "test-capture",
    };

    function getMessageHandler() {
        return {
            handleCaptureFileDownload: (node: string) => {
                console.log(`Running retina capture on node ${node}`);
            },
            getAllNodes: () => {
                console.log("Getting all nodes");
            },
            retinaCaptureResult: (result: string) => {
                console.log(`Retina capture result: ${result}`);
            },
        };

    }

    return [
        Scenario.create(
            "retinaCapture",
            "",
            () => <RetinaCapture {...initialState} />,
            getMessageHandler,
            stateUpdater.vscodeMessageHandler,
        ),
    ];

}