import {
    CaptureName,
    InterfaceName,
    NodeCaptureDownloadResult,
    NodeCaptureStopResult,
    NodeCheckResult,
    NodeCommandResult,
    NodeName,
    ValueCommandResult,
} from "../../../../src/webview-contract/webviewDefinitions/tcpDump";
import { replaceItem } from "../../utilities/array";
import { newLoaded, newNotLoaded } from "../../utilities/lazy";
import {
    CaptureFilterSelection,
    CaptureStatus,
    NodeCapture,
    NodeState,
    NodeStatus,
    ScenarioFilterValue,
} from "../state";
import * as ScenarioFiltersUpdate from "./scenarioFiltersUpdate";

export function getInitialNodeState(node: NodeName): NodeState {
    return {
        status: NodeStatus.Unknown,
        errorMessage: null,
        currentCaptureName: null,
        currentCaptureFilters: {
            interface: null,
            scenario: null,
            scenarioFilters: {
                SpecificPod: {
                    pod: null,
                    packetDirection: "SentAndReceived",
                },
                TwoPods: {
                    sourceNode: node,
                    sourcePod: null,
                    destNode: node,
                    destPod: null,
                    packetDirection: "Bidirectional",
                },
            },
            appLayerProtocol: null,
            port: null,
            transportLayerProtocol: null,
            pcapFilterString: null,
        },
        completedCaptures: [],
        captureInterfaces: newNotLoaded(),
    };
}

export function updateFromNodeCheck(state: NodeState, result: NodeCheckResult): NodeState {
    const status = !result.isDebugPodRunning
        ? NodeStatus.Clean
        : result.runningCapture === null
          ? NodeStatus.DebugPodRunning
          : NodeStatus.CaptureRunning;

    const currentCaptureName = result.runningCapture;

    const completedCaptures = result.completedCaptures.map<NodeCapture>((c) => ({
        name: c.name,
        sizeInKB: c.sizeInKB,
        status: CaptureStatus.Completed,
        downloadedFilePath: null,
    }));

    return { ...state, status, currentCaptureName, completedCaptures };
}

export function updateFromStartPodResult(state: NodeState, result: NodeCommandResult): NodeState {
    const errorMessage = result.succeeded ? null : result.errorMessage;
    const status = result.succeeded ? NodeStatus.DebugPodRunning : NodeStatus.Unknown;
    return { ...state, status, errorMessage };
}

export function updateFromDeletePodResult(state: NodeState, result: NodeCommandResult): NodeState {
    const errorMessage = result.succeeded ? null : result.errorMessage;
    const status = result.succeeded ? NodeStatus.Clean : NodeStatus.Unknown;
    const currentCaptureName = null;
    const completedCaptures: NodeCapture[] = [];
    return {
        ...state,
        status,
        errorMessage,
        currentCaptureName,
        completedCaptures,
    };
}

export function updateCaptureInterfaces(
    state: NodeState,
    result: ValueCommandResult<NodeCommandResult, InterfaceName[]>,
): NodeState {
    if (!result.succeeded) {
        return { ...state, errorMessage: result.errorMessage };
    }

    return { ...state, captureInterfaces: newLoaded(result.value) };
}

export function updateScenarioFilter(state: NodeState, value: ScenarioFilterValue): NodeState {
    return {
        ...state,
        currentCaptureFilters: {
            ...state.currentCaptureFilters,
            scenarioFilters: ScenarioFiltersUpdate.updateScenarioFilter(
                state.currentCaptureFilters.scenarioFilters,
                value,
            ),
        },
    };
}

export function refreshPcapFilterString(state: NodeState): NodeState {
    // https://www.tcpdump.org/manpages/pcap-filter.7.html
    // https://docs.netgate.com/pfsense/en/latest/diagnostics/packetcapture/tcpdump.html
    const parts = [];
    if (state.currentCaptureFilters.port && state.currentCaptureFilters.transportLayerProtocol) {
        const protocol = state.currentCaptureFilters.transportLayerProtocol.toLowerCase();
        parts.push(`${protocol} port ${state.currentCaptureFilters.port}`);
    } else if (state.currentCaptureFilters.port) {
        parts.push(`port ${state.currentCaptureFilters.port}`);
    } else if (state.currentCaptureFilters.transportLayerProtocol) {
        const protocol = state.currentCaptureFilters.transportLayerProtocol.toLowerCase();
        parts.push(protocol);
    }

    parts.push(...getPcapFilterStringParts(state.currentCaptureFilters));

    return {
        ...state,
        currentCaptureFilters: { ...state.currentCaptureFilters, pcapFilterString: parts.join(" and ") },
    };
}

function getPcapFilterStringParts(filters: CaptureFilterSelection): string[] {
    if (!filters.scenario) return [];
    return ScenarioFiltersUpdate.getPcapFilterStringParts(filters.scenario, filters.scenarioFilters);
}

export function updateFromCaptureStarting(state: NodeState, capture: CaptureName): NodeState {
    return {
        ...state,
        status: NodeStatus.CaptureStarting,
        currentCaptureName: capture,
    };
}

export function updateFromCaptureStartResult(state: NodeState, result: NodeCommandResult): NodeState {
    const errorMessage = result.succeeded ? null : result.errorMessage;
    const status = result.succeeded ? NodeStatus.CaptureRunning : NodeStatus.DebugPodRunning;
    const currentCaptureName = result.succeeded ? state.currentCaptureName : null;
    return { ...state, status, errorMessage, currentCaptureName };
}

export function updateFromCaptureStopResult(state: NodeState, result: NodeCaptureStopResult): NodeState {
    const errorMessage = result.succeeded ? null : result.errorMessage;
    const status = result.succeeded ? NodeStatus.DebugPodRunning : NodeStatus.Unknown;
    const newCapture: NodeCapture | null =
        result.succeeded && result.capture
            ? {
                  name: result.capture.name,
                  sizeInKB: result.capture.sizeInKB,
                  status: CaptureStatus.Completed,
                  downloadedFilePath: null,
              }
            : null;
    const completedCaptures: NodeCapture[] = newCapture
        ? [...state.completedCaptures, newCapture]
        : state.completedCaptures;
    return { ...state, status, errorMessage, completedCaptures };
}

export function updateFromDownloadStarting(state: NodeState, captureName: CaptureName): NodeState {
    return updateCompletedCapture(state, captureName, (c) => ({ ...c, status: CaptureStatus.Downloading }));
}

export function updateFromDownloadResult(state: NodeState, result: NodeCaptureDownloadResult): NodeState {
    const errorMessage = result.succeeded ? null : result.errorMessage;
    const status = result.succeeded ? CaptureStatus.Downloaded : CaptureStatus.Completed;
    const downloadedFilePath = result.succeeded ? result.localCapturePath : null;
    return {
        ...updateCompletedCapture(state, result.captureName, (c) => ({
            ...c,
            status,
            downloadedFilePath,
        })),
        errorMessage,
    };
}

function updateCompletedCapture(
    state: NodeState,
    captureName: CaptureName,
    updater: (capture: NodeCapture) => NodeCapture,
): NodeState {
    const completedCaptures = replaceItem(state.completedCaptures, (c) => c.name === captureName, updater);
    return { ...state, completedCaptures };
}
