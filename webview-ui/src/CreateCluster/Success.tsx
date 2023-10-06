import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

interface SuccessProps {
    portalUrl: string
    portalReferrerContext: string
    subscriptionId: string
    resourceGroup: string
    name: string
}

export function Success(props: SuccessProps) {
    const armId = `/subscriptions/${props.subscriptionId}/resourceGroups/${props.resourceGroup}/providers/Microsoft.ContainerService/managedClusters/${props.name}`;
    const portalUrl = `${props.portalUrl.replace(/\/$/, "")}/#resource${armId}/overview?referrer_source=vscode&referrer_context=${props.portalReferrerContext}`;

    return (
        <>
            <h3>Cluster {props.name} was created successfully</h3>
            <p>Click <VSCodeLink href={portalUrl}>here</VSCodeLink> to view your cluster in the Azure Portal.</p>
        </>
    );
}