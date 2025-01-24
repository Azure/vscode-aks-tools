import { FormEvent, useState } from "react";
import { HubMode } from "../../../src/webview-contract/webviewDefinitions/createFleet";
import { hasMessage, invalid, isValueSet, unset, valid, Validatable } from "../utilities/validation";
import { VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
// To ensure consistent formats and styles across features, it uses the same CSS file as CreateCluster.tsx
// TODO: considering restructuring the CSS file to be more modular and reusable
import styles from "../CreateCluster/CreateCluster.module.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimesCircle } from "@fortawesome/free-solid-svg-icons";

type ChangeEvent = Event | FormEvent<HTMLElement>;

export interface CreateFleetInputProps {
    onModeSelected: (modeSelected: HubMode) => void;
    onDnsPrefixChange: (dnsPrefix: string) => void;
}

export function CreateFleetModeInput(props: CreateFleetInputProps) {
    const [selectedMode, setSelectedMode] = useState<HubMode>(HubMode.Without);
    const [dnsPrefix, setDnsPrefix] = useState<Validatable<string>>(unset());

    function handleModeClick(modeSelected: HubMode) {
        props.onModeSelected(modeSelected);
        setSelectedMode(modeSelected);
    }

    function handlednsPrefixChange(e: ChangeEvent) {
        const dnsPrefix = (e.currentTarget as HTMLInputElement).value;
        const validated = getValidatedDnsPrefix(dnsPrefix);
        props.onDnsPrefixChange(isValueSet(validated) ? validated.value : "");
        setDnsPrefix(validated);
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
                <h3>Hub Cluster Mode Configuration: ${selectedMode}</h3>
                <button
                    type="button"
                    onClick={() => handleModeClick(HubMode.Without)}
                    style={{ backgroundColor: selectedMode === HubMode.Without ? "blue" : "grey" }}
                >
                    Without Hub Cluster
                </button>
                <button
                    type="button"
                    onClick={() => handleModeClick(HubMode.With)}
                    style={{ backgroundColor: selectedMode === HubMode.With ? "blue" : "grey" }}
                >
                    With Hub Cluster
                </button>
                {selectedMode === HubMode.With && (
                    <div>
                        <label className={styles.label}>DNS name prefix*</label>
                        <VSCodeTextField
                            id="dns-input"
                            value={isValueSet(dnsPrefix) ? dnsPrefix.value : ""}
                            className={`${styles.longControl} ${styles.validatable}`}
                            onBlur={handlednsPrefixChange}
                            onChange={handlednsPrefixChange}
                        />
                        {hasMessage(dnsPrefix) && (
                            <span className={styles.validationMessage}>
                                <FontAwesomeIcon className={styles.errorIndicator} icon={faTimesCircle} />
                                {dnsPrefix.message}
                            </span>
                        )}
                        <br />
                    </div>
                )}
            </div>
        </>
    );
}
