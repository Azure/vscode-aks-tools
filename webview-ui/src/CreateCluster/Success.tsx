import { VSCodeLink } from "@vscode/webview-ui-toolkit/react";

interface SuccessProps {
    portalClusterUrl: string;
    name: string;
}

export function Success(props: SuccessProps) {
    return (
        <>
            <h3>Cluster {props.name} was created successfully</h3>
            <p>
                Click <VSCodeLink href={props.portalClusterUrl}>here</VSCodeLink> to view your cluster in the Azure
                Portal.
            </p>
        </>
    );
}
