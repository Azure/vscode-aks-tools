import * as l10n from "@vscode/l10n";

interface SuccessProps {
    portalClusterUrl: string;
    name: string;
    isMergingKubeconfig: boolean;
    onMergeKubeconfig: () => void;
}

export function Success(props: SuccessProps) {
    return (
        <>
            <h3>Cluster {props.name} was created successfully</h3>
            <p>
                Click <a href={props.portalClusterUrl}>here</a> to view your cluster in the Azure Portal.
            </p>
            <button type="button" disabled={props.isMergingKubeconfig} onClick={props.onMergeKubeconfig}>
                {l10n.t("Merge into Kubeconfig")}
            </button>
        </>
    );
}
