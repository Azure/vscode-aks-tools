import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import styles from "./Kaito.module.css";

export type KaitoCredentialCopyProps = {
    resourceGroup: string;
    clusterName: string;
    subscription: string;
};

export function KaitoCredentialCopy(props: KaitoCredentialCopyProps) {
    const roleAssigmentCommand =
        `export MC_RESOURCE_GROUP=$(az aks show --resource-group $AZURE_RESOURCE_GROUP --name $CLUSTER_NAME --query nodeResourceGroup -o tsv)
export PRINCIPAL_ID=$(az identity show --name ai-toolchain-operator-$CLUSTER_NAME --resource-group $MC_RESOURCE_GROUP --query 'principalId' -o tsv)
export KAITO_IDENTITY_NAME="ai-toolchain-operator-$CLUSTER_NAME"
az role assignment create --role "Contributor" --assignee $PRINCIPAL_ID --scope "/subscriptions/$AZURE_SUBSCRIPTION_ID/resourcegroups/$AZURE_RESOURCE_GROUP"`
            .replaceAll("$AZURE_RESOURCE_GROUP", props.resourceGroup)
            .replaceAll("$AZURE_SUBSCRIPTION_ID", props.subscription)
            .replaceAll("$CLUSTER_NAME", props.clusterName);

    const federatedCredentialsCommand =
        `export AKS_OIDC_ISSUER=$(az aks show --resource-group $AZURE_RESOURCE_GROUP --name $CLUSTER_NAME --query "oidcIssuerProfile.issuerUrl" -o tsv)
az identity federated-credential create --name "kaito-federated-identity" --identity-name $KAITO_IDENTITY_NAME -g $MC_RESOURCE_GROUP --issuer $AKS_OIDC_ISSUER --subject system:serviceaccount:"kube-system:kaito-gpu-provisioner" --audience api://AzureADTokenExchange`
            .replaceAll("$AZURE_RESOURCE_GROUP", props.resourceGroup)
            .replaceAll("$SUBSCRIPTION", props.subscription)
            .replaceAll("$CLUSTER_NAME", props.clusterName);

    const kubectlRolloutRestartCommand = `kubectl rollout restart deployment/kaito-gpu-provisioner -n kube-system`;

    const copyCommand = (text: string) => {
        navigator.clipboard
            .writeText(text)
            .then(() => {
                alert("Command copied to clipboard!");
            })
            .catch((err) => {
                console.error("Failed to copy command: ", err);
            });
    };

    return (
        <div>
            <p className={styles.installingMessage}>Installing KAITO, this may take a few minutes...</p>
            <label className={styles.installingMessage}>
                For the gpu provisioner pod to work, please follow the steps below to create role assignments and
                federated credentials using terminal while KAITO is installing.
            </label>
            <ul>
                <li>
                    <p>Create an identity and assign permissions</p>
                    <label>
                        The identity kaitoprovisioner is created for the gpu-provisioner controller. It is assigned
                        Contributor role for the managed cluster resource to allow changing {props.clusterName} (e.g.,
                        provisioning new nodes in it).
                    </label>
                    <div className={styles.commandContainer}>
                        <pre className={styles.commandText}>{roleAssigmentCommand}</pre>
                        <VSCodeButton className={styles.copyButton} onClick={() => copyCommand(roleAssigmentCommand)}>
                            Copy
                        </VSCodeButton>
                    </div>
                </li>
                <li>
                    <p>Create the federated credential</p>
                    <label>
                        The federated identity credential between the managed identity kaitoprovisioner and the service
                        account used by the gpu-provisioner controller is created.
                    </label>
                    <div className={styles.commandContainer}>
                        <pre className={styles.commandText}>{federatedCredentialsCommand}</pre>
                        <VSCodeButton
                            className={styles.copyButton}
                            onClick={() => copyCommand(federatedCredentialsCommand)}
                        >
                            Copy
                        </VSCodeButton>
                    </div>
                </li>
                <li>
                    <p>Rollout restart gpu provisioner pods after KAITO is installed</p>
                    <label>
                        Restart the gpu provisioner pods to apply the new configuration after KAITO is installe.
                    </label>
                    <div className={styles.commandContainer}>
                        <pre className={styles.commandText}>{kubectlRolloutRestartCommand}</pre>
                        <VSCodeButton
                            className={styles.copyButton}
                            onClick={() => copyCommand(kubectlRolloutRestartCommand)}
                        >
                            Copy
                        </VSCodeButton>
                    </div>
                </li>
            </ul>
        </div>
    );
}
