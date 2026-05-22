import { Subscription, Cluster, Acr } from "../../../src/webview-contract/webviewDefinitions/attachAcrToCluster";
import { ResourceSelector } from "../components/ResourceSelector";
import styles from "./Kickstart.module.css";
import * as l10n from "@vscode/l10n";

export type PickersProps = {
    subscriptions: Subscription[];
    selectedSub: Subscription | null;
    onSubChange: (sub: Subscription | null) => void;

    resourceGroups: string[];
    selectedRg: string | null;
    onRgChange: (rg: string | null) => void;

    clusters: Cluster[];
    selectedCluster: Cluster | null;
    onClusterChange: (cluster: Cluster | null) => void;

    acrs: Acr[];
    selectedAcr: Acr | null;
    onAcrChange: (acr: Acr | null) => void;
};

export function Pickers(props: PickersProps) {
    return (
        <fieldset className={styles.inputContainer}>
            <label htmlFor="subscription-input" className={styles.label}>
                {l10n.t("Subscription")}
            </label>
            <div data-testid="kickstart-subscription" className={styles.control}>
                <ResourceSelector<Subscription>
                    id="subscription-input"
                    resources={props.subscriptions}
                    selectedItem={props.selectedSub}
                    valueGetter={(s) => s.subscriptionId}
                    labelGetter={(s) => s.name}
                    onSelect={props.onSubChange}
                />
            </div>

            <label htmlFor="acr-rg-input" className={styles.label}>
                {l10n.t("Resource Group")}
            </label>
            <div data-testid="kickstart-resource-group" className={styles.control}>
                <ResourceSelector<string>
                    id="acr-rg-input"
                    resources={props.resourceGroups}
                    selectedItem={props.selectedRg}
                    valueGetter={(g) => g}
                    labelGetter={(g) => g}
                    onSelect={props.onRgChange}
                />
            </div>

            <label htmlFor="cluster-input" className={styles.label}>
                {l10n.t("Cluster")}
            </label>
            <div data-testid="kickstart-cluster" className={styles.control}>
                <ResourceSelector<Cluster>
                    id="cluster-input"
                    resources={props.clusters}
                    selectedItem={props.selectedCluster}
                    valueGetter={(c) => c.clusterName}
                    labelGetter={(c) => c.clusterName}
                    onSelect={props.onClusterChange}
                />
            </div>

            <label htmlFor="acr-input" className={styles.label}>
                {l10n.t("Container Registry")}
            </label>
            <div data-testid="kickstart-acr" className={styles.control}>
                <ResourceSelector<Acr>
                    id="acr-input"
                    resources={props.acrs}
                    selectedItem={props.selectedAcr}
                    valueGetter={(acr) => acr.acrName}
                    labelGetter={(acr) => acr.acrName}
                    onSelect={props.onAcrChange}
                />
            </div>
        </fieldset>
    );
}
