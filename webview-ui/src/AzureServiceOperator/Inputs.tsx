import { VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";
import styles from "./AzureServiceOperator.module.css";
import { ASOState, EventDef, InstallStepStatus } from "./helpers/state";
import { EventHandlers } from "../utilities/state";
import { FormEvent } from "react";
import { ToVsCodeMsgDef } from "../../../src/webview-contract/webviewDefinitions/azureServiceOperator";
import { MessageSink } from "../../../src/webview-contract/messaging";
import { getRequiredInputs } from "./helpers/inputs";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faInfoCircle } from "@fortawesome/free-solid-svg-icons";

type ChangeEvent = Event | FormEvent<HTMLElement>;

export interface InputsProps {
    state: ASOState;
    handlers: EventHandlers<EventDef>;
    vscode: MessageSink<ToVsCodeMsgDef>;
}

export function Inputs(props: InputsProps) {
    const { appId, appSecret, subscriptions, selectedSubscription, checkSPStep, installCertManagerStep } = props.state;

    function handleAppIdChange(e: ChangeEvent) {
        const input = e.currentTarget as HTMLInputElement;
        props.handlers.onSetAppId(input.value || null);
    }

    function handleAppSecretChange(e: ChangeEvent) {
        const input = e.currentTarget as HTMLInputElement;
        props.handlers.onSetAppSecret(input.value || null);
    }

    function handleCheckSPClick() {
        if (!appId || !appSecret) {
            return;
        }

        props.vscode.postCheckSPRequest({ appId, appSecret });
        props.handlers.onSetCheckingSP();
    }

    function handleSubscriptionChanged(e: Event | FormEvent<HTMLElement>) {
        const elem = e.target as HTMLInputElement;
        const subscriptionId = elem.value || null;
        props.handlers.onSetSelectedSubscriptionId(subscriptionId);
    }

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        e.stopPropagation();
        props.vscode.postInstallCertManagerRequest();
        props.handlers.onSetInstallCertManagerStarted();
    }

    const canEditSP =
        checkSPStep.status === InstallStepStatus.NotStarted || checkSPStep.status === InstallStepStatus.Failed;
    const canCheckSP = canEditSP && appId !== null && appSecret !== null;
    const canViewSubscriptions = checkSPStep.status === InstallStepStatus.Succeeded;
    const isInstallStarted = installCertManagerStep.status !== InstallStepStatus.NotStarted;
    const canSelectSubscription = !isInstallStarted;
    const canStartInstalling = !isInstallStarted && getRequiredInputs(props.state) !== null;

    return (
        <form onSubmit={handleSubmit}>
            <div className={styles.inputContainer}>
                <h3>Service Principal</h3>
                <p>
                    <FontAwesomeIcon className={styles.infoIndicator} icon={faInfoCircle} />
                    Provide the App ID and password of a Service Principal with Contributor permissions for your
                    subscription. This allows ASO to create resources in your subscription on your behalf.
                    <a href="https://docs.microsoft.com/en-us/cli/azure/create-an-azure-service-principal-azure-cli">
                        &nbsp; Learn more
                    </a>
                </p>

                <label htmlFor="spappid" className={styles.label}>
                    Enter App ID of service principal:
                </label>
                <input
                    type="text"
                    value={appId || ""}
                    readOnly={!canEditSP}
                    required
                    id="spappid"
                    onInput={handleAppIdChange}
                    className={styles.control}
                    size={50}
                    placeholder="e.g. 041ccd53-e72f-45d1-bbff-382c82f6f9a1"
                />

                <label htmlFor="spcred" className={styles.label}>
                    Enter Password of Service Principal:
                </label>
                <input
                    value={appSecret || ""}
                    readOnly={!canEditSP}
                    required
                    id="spcred"
                    onInput={handleAppSecretChange}
                    className={styles.control}
                    size={50}
                    type="password"
                    placeholder="Service principal password"
                />

                <button disabled={!canCheckSP} onClick={handleCheckSPClick}>
                    Check
                </button>
            </div>
            {canViewSubscriptions && (
                <div className={styles.inputContainer}>
                    <h3>Subscription</h3>
                    <p>
                        <FontAwesomeIcon className={styles.infoIndicator} icon={faInfoCircle} />
                        The supplied service principal has some role assignments on the following subscriptions. Please
                        ensure these are adequate for the Azure resources that ASO will be creating in your selected
                        subscription.
                        <a href="https://azure.github.io/azure-service-operator/#installation">&nbsp; Learn more</a>
                    </p>

                    <label htmlFor="sub-select" className={styles.label}>
                        Subscription for ASO resources:
                    </label>
                    <VSCodeDropdown
                        id="sub-select"
                        value={selectedSubscription?.id || ""}
                        className={styles.control}
                        disabled={!canSelectSubscription}
                        onChange={handleSubscriptionChanged}
                    >
                        {subscriptions.length !== 1 && <VSCodeOption value="">Select</VSCodeOption>}
                        {subscriptions.map((s) => (
                            <VSCodeOption value={s.id} key={s.id}>
                                {s.name}
                            </VSCodeOption>
                        ))}
                    </VSCodeDropdown>
                    <button disabled={!canStartInstalling} type="submit">
                        Install
                    </button>
                </div>
            )}
        </form>
    );
}
