import { CommandResult, InitialState, ValueCommandResult } from "../../../src/webview-contract/webviewDefinitions/retinaCapture";
import { FilterPod } from "../../../src/webview-contract/webviewDefinitions/tcpDump";
import { Lazy } from "../utilities/lazy";
import { WebviewStateUpdater } from "../utilities/state";
import { getWebviewMessageContext } from "../utilities/vscode";

export type EventDef = Record<string, never>;

export type RetinaState = InitialState & {
    selectedNode: NodeName | null;
    nodeStates: NodeStates;
    referenceData: ReferenceData;
};

export type NodeName = string;
export type PodName = string;
export type CaptureName = string;
export type InterfaceName = string;

export enum NodeStatus {
    Unknown,
    Checking,
    Clean,
    CreatingDebugPod,
    DeletingDebugPod,
    DebugPodRunning,
    CaptureStarting,
    CaptureRunning,
    CaptureStopping,
}

export enum RetinaCaptureStatus {
    Completed,
    Downloading,
    Downloaded,
}

export type CaptureScenario = "SpecificPod" | "TwoPods";

export type CaptureScenarioFilters = {
    SpecificPod: SpecificPodFilter;
    TwoPods: TwoPodsFilter;
};

export type ScenarioFilterValue = {
    [P in CaptureScenario]: {
        node: NodeName;
        scenario: P;
        filters: CaptureScenarioFilters[P];
    };
}[CaptureScenario];

export type SpecificPodFilter = {
    pod: FilterPod | null;
    packetDirection: SingleEndpointPacketDirection;
};

export type TwoPodsFilter = {
    sourceNode: NodeName | null;
    sourcePod: FilterPod | null;
    destNode: NodeName | null;
    destPod: FilterPod | null;
    packetDirection: DualEndpointPacketDirection;
};

export type SingleEndpointPacketDirection = "SentAndReceived" | "Sent" | "Received";

export type DualEndpointPacketDirection = "SourceToDestination" | "Bidirectional";

export type NodeState = {
    status: NodeStatus;
    errorMessage: string | null;
    currentCaptureName: CaptureName | null;
    completedCaptures: NodeCapture[];
    captureInterfaces: Lazy<InterfaceName[]>;
};

type NodeStates = { [name: NodeName]: NodeState };

export type NodeCapture = {
    name: CaptureName;
    status: RetinaCaptureStatus;
    sizeInKB: number;
    downloadedFilePath: string | null;
};

export type TcpDumpState = InitialState & {
    selectedNode: NodeName | null;
    nodeStates: NodeStates;
    referenceData: ReferenceData;
};

export type ReferenceData = {
    nodes: Lazy<NodeReferenceData[]>;
};

export type NodeReferenceData = {
    node: NodeName;
    filterPods: Lazy<FilterPod[]>;
};


export const stateUpdater: WebviewStateUpdater<"retinaCapture", EventDef, RetinaState> = {
    createState: (initialState) => ({
        ...initialState,
        nodeStates: {},
        referenceData: { nodes: [] as unknown as Lazy<NodeReferenceData[]> },
    }),
    vscodeMessageHandler: {
        startCaptureResponse: function (state: RetinaState, msg: string): RetinaState {
            console.log(msg);
            console.log(state);
            throw new Error("Function not implemented.");
        },
        getAllNodesResponse: function (state: InitialState, msg: ValueCommandResult<CommandResult, string[]>): RetinaState {
            console.log(msg);
            console.log(state);
            throw new Error("Function not implemented.");
        }
    },
    eventHandler: {},
};

export const vscode = getWebviewMessageContext<"retinaCapture">({
    retinaCaptureResult: undefined,
    getAllNodes: undefined,
    openFolder: undefined,
    runRetinaCapture: undefined,
});
