import { Message } from "../../../../src/webview-contract/messaging";
import { TraceGadget } from "./gadgets";

export type UserMsgDef = {
    setInitializing: void,
    deploy: void,
    undeploy: void,
    incrementTraceId: void,
    createTrace: {
        trace: TraceGadget
    },
    deleteTraces: {
        traceIds: number[]
    },
    setNodesLoading: void,
    setNamespacesLoading: void,
    setPodsLoading: {
        namespace: string
    },
    setContainersLoading: {
        namespace: string,
        podName: string
    },
    setNodesNotLoaded: void,
    setNamespacesNotLoaded: void
}

export type UserMessage = Message<UserMsgDef>;
