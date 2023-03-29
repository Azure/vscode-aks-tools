import { PeriscopeTypes } from "../../../src/webview-contract/webviewTypes"

export interface NodeLogsProps {
    node: string
    podLogs: PeriscopeTypes.PodLogs[]
}

export function NodeLogs(props: NodeLogsProps) {
    return (
        <>
            <h3>{props.node} Node Logs</h3>
            {
                (props.podLogs || []).map(podLog => (
                    <div key={podLog.podName}>
                        <h4>{podLog.podName}</h4>
                        <pre>{podLog.logs}</pre>
                    </div>
                ))
            }
        </>
    );
}