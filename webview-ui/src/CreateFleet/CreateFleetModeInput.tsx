import { FormEvent } from "react";
import { HubMode } from "../../../src/webview-contract/webviewDefinitions/createFleet";
import { hasMessage, invalid, isValueSet, valid, Validatable } from "../utilities/validation";
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import styles from "./CreateFleet.module.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";
// Using the icon templates from createCluster. Consider abstracting the classes to improve code reusability
import { AutomaticIcon } from "../icons/AutomaticIcon";
import { DevTestIcon } from "../icons/DevTestIcon";

type ChangeEvent = Event | FormEvent<HTMLElement>;

export interface CreateFleetInputProps {
    hubMode: HubMode;
    dnsPrefix: Validatable<string>;
    onModeSelected: (modeSelected: HubMode) => void;
    onDnsPrefixChange: (dnsPrefix: Validatable<string>) => void;
}

export function CreateFleetModeInput(props: CreateFleetInputProps) {
    function handleModeClick(modeSelected: HubMode) {
        props.onModeSelected(modeSelected);
    }

    function handleDnsPrefixChange(e: ChangeEvent) {
        const dnsPrefix = (e.currentTarget as HTMLInputElement).value;
        const validated = getValidatedDnsPrefix(dnsPrefix);
        props.onDnsPrefixChange(validated);
    }

    function getValidatedDnsPrefix(dns: string): Validatable<string> {
        // dnsPrefix validation rules from the Azure REST API specs
        // https://github.com/Azure/azure-rest-api-specs/blob/24d856b33d49b5ac6227a51c610b7d8b0f289458/specification/containerservice/resource-manager/Microsoft.ContainerService/fleet/stable/2024-04-01/fleets.json#L1866-L1871
        if (!dns) return invalid(dns, "The DNS name prefix cannot be empty.");
        if (dns.length > 63) return invalid(dns, "The DNS name prefix must be at most 63 characters long.");
        if (!/^[a-zA-Z0-9]$|^[a-zA-Z0-9][a-zA-Z0-9-]{0,52}[a-zA-Z0-9]$/.test(dns)) {
            return invalid(
                dns,
                "The DNS name can contain only letters, numbers, and hyphens. The name must start and end with a letter or a number.",
            );
        }
        return valid(dns);
    }

    return (
        <>
            <div>
                <h3>Hub Cluster Mode Configuration:</h3>
                <div style={{ display: "flex" }}>
                    <div
                        className={`${styles.hubModeContainer} ${props.hubMode === HubMode.With ? styles.hubModeContainerHighlighted : ""}`}
                        onClick={() => handleModeClick(HubMode.With)}
                    >
                        <div className={styles.flexContainer}>
                            <AutomaticIcon className={styles.svgContainer} style={{ width: "1rem", height: "1rem" }} />
                            <div className={styles.hubModeTitle}>With Hub Cluster</div>
                        </div>
                        <div className={styles.hubModeDescription}>
                            A standard tier AKS cluster managed by Microsoft and hosted on your subscription. Can be
                            used for multi-cluster updates, Kubernetes resource object propagation, and multi-cluster
                            load balancing.
                        </div>
                    </div>
                    <div
                        className={`${styles.hubModeContainer} ${props.hubMode === HubMode.Without ? styles.hubModeContainerHighlighted : ""}`}
                        onClick={() => handleModeClick(HubMode.Without)}
                    >
                        <div className={styles.flexContainer}>
                            <DevTestIcon className={styles.svgContainer} style={{ width: "1rem", height: "1rem" }} />
                            <div className={styles.hubModeTitle}>Without Hub Cluster</div>
                        </div>
                        <div className={styles.hubModeDescription}>
                            Use fleet as an abstract grouping resource to perform multi-cluster update orchestration.
                        </div>
                    </div>
                </div>

                {props.hubMode === HubMode.With && (
                    <div className={styles.inputContainer}>
                        <label className={styles.label}>DNS name prefix*</label>
                        <VSCodeTextField
                            id="dns-input"
                            value={isValueSet(props.dnsPrefix) ? props.dnsPrefix.value : ""}
                            className={`${styles.longControl} ${styles.validatable}`}
                            onBlur={handleDnsPrefixChange}
                            onChange={handleDnsPrefixChange}
                        />
                        {hasMessage(props.dnsPrefix) && (
                            <span className={styles.validationMessage}>
                                <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                {props.dnsPrefix.message}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}
