import { MessageHandler, MessageSink } from "../../../src/webview-contract/messaging";
import { AzureCloudName, CommandResult, InitialState, InstallStepResult, Subscription, ToVsCodeMsgDef, ToWebViewMsgDef } from "../../../src/webview-contract/webviewDefinitions/azureServiceOperator";
import { AzureServiceOperator } from "../AzureServiceOperator/AzureServiceOperator";
import { stateUpdater } from "../AzureServiceOperator/helpers/state";
import { Scenario } from "../utilities/manualTest";

type App = {
    id: string,
    secret: string
};

const subscriptions: Subscription[] = [
    {id: "subA", name: "Sub A"},
    {id: "subB", name: "Sub B"},
    {id: "subC", name: "Sub C"},
    {id: "subD", name: "Sub D"},
    {id: "subE", name: "Sub E"},
    {id: "subF", name: "Sub F"},
    {id: "subG", name: "Sub G"},
    {id: "subH", name: "Sub H"},
    {id: "subI", name: "Sub I"},
    {id: "subJ", name: "Sub J"}
];

const apps: App[] = [
    {id: "appA", secret: "a"},
    {id: "appB", secret: "b"},
    {id: "appC", secret: "c"},
    {id: "appD", secret: "d"}
];

const appSubscriptions = new Map<string, Subscription[]>([
    ["appA", subscriptions.slice(0, 4)],
    ["appB", subscriptions.slice(3, 8)],
    ["appC", [...subscriptions]],
    ["appD", []]
]);

export function getASOScenarios() {
    const initialState: InitialState = {
        clusterName: "test-cluster"
    };

    function sometimes() {
        return ~~(Math.random() * 3) === 0;
    }

    function getMessageHandler(webview: MessageSink<ToWebViewMsgDef>, withErrors: boolean): MessageHandler<ToVsCodeMsgDef> {
        return {
            checkSPRequest: args => handleCheckSPRequest(args.appId, args.appSecret, webview),
            installCertManagerRequest: _ => handleInstallCertManagerRequest(withErrors && sometimes(), webview),
            waitForCertManagerRequest: _ => handleWaitForCertManagerRequest(withErrors && sometimes(), webview),
            installOperatorRequest: _ => handleInstallOperatorRequest(withErrors && sometimes(), webview),
            installOperatorSettingsRequest: args => handleInstallOperatorSettingsRequest(withErrors && sometimes(), args.tenantId, args.subscriptionId, args.appId, args.appSecret, args.cloudName, webview),
            waitForControllerManagerRequest: _ => handleWaitForControllerManagerRequest(withErrors && sometimes(), webview)
        };
    }

    async function handleCheckSPRequest(appId: string, appSecret: string, webview: MessageSink<ToWebViewMsgDef>) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const matchingApp = apps.find(app => app.id === appId);
        if (!matchingApp) {
            webview.postCheckSPResponse({
                succeeded: false,
                errorMessage: `App ${appId} not found. Known app IDs are: ${apps.map(app => app.id).join(", ")}`,
                commandResults: [],
                cloudName: null,
                tenantId: null,
                subscriptions: []
            });
            return;
        }

        if (matchingApp.secret !== appSecret) {
            webview.postCheckSPResponse({
                succeeded: false,
                errorMessage: `Incorrect secret for ${appId}. The actual secret is "${matchingApp.secret}"`,
                commandResults: [],
                cloudName: null,
                tenantId: null,
                subscriptions: []
            });
            return;
        }

        const subscriptions = appSubscriptions.get(appId) || [];
        if (subscriptions.length === 0) {
            webview.postCheckSPResponse({
                succeeded: false,
                errorMessage: `App ${appId} does not have permission to access any subscriptions.`,
                commandResults: [],
                cloudName: "AzureCloud",
                tenantId: "tenant",
                subscriptions: []
            });
            return;
        }

        webview.postCheckSPResponse({
            succeeded: true,
            errorMessage: null,
            commandResults: [],
            cloudName: "AzureCloud",
            tenantId: "tenant",
            subscriptions
        });
    }

    function getCommandResult(hasError: boolean, command: string): CommandResult {
        if (hasError) {
            return {
                command,
                stdout: `Trying to execute ${command}`,
                stderr: `Failed to execute ${command}`
            };
        }
        return {
            command,
            stdout: `Successfully ran ${command}`,
            stderr: ""
        };
    }

    function getInstallStepResult(hasError: boolean, stepName: string, commands: string[]): InstallStepResult {
        if (hasError) {
            return {
                succeeded: false,
                errorMessage: `Failed to ${stepName} because something went wrong.`,
                commandResults: [...commands.slice(0, -1).map(c => getCommandResult(false, c)), getCommandResult(true, commands[commands.length - 1])]
            };
        }
        return {
            succeeded: true,
            errorMessage: null,
            commandResults: commands.map(c => getCommandResult(false, c))
        };
    }

    async function handleInstallCertManagerRequest(hasError: boolean, webview: MessageSink<ToWebViewMsgDef>) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const commands = ["kubectl install cert-manager"];
        webview.postInstallCertManagerResponse(getInstallStepResult(hasError, "install cert-manager", commands));
    }

    async function handleWaitForCertManagerRequest(hasError: boolean, webview: MessageSink<ToWebViewMsgDef>) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const commands = ['cert-manager', 'cert-manager-cainjector', 'cert-manager-webhook'].map(c => `kubectl check deployment ${c}`);
        webview.postWaitForCertManagerResponse(getInstallStepResult(hasError, "wait for cert-manager", commands));
    }

    async function handleInstallOperatorRequest(hasError: boolean, webview: MessageSink<ToWebViewMsgDef>) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const commands = ["kubectl install ASO operator"];
        webview.postInstallOperatorResponse(getInstallStepResult(hasError, "install operator", commands));
    }

    async function handleInstallOperatorSettingsRequest(hasError: boolean, tenantId: string, subscriptionId: string, appId: string, appSecret: string, cloudName: AzureCloudName, webview: MessageSink<ToWebViewMsgDef>) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const commands = [`kubectl create secret [tenantId=${tenantId}, subId=${subscriptionId}, appId=${appId}, secret=${appSecret}, cloud=${cloudName}]`];
        webview.postInstallOperatorSettingsResponse(getInstallStepResult(hasError, "install settings secret", commands));
    }

    async function handleWaitForControllerManagerRequest(hasError: boolean, webview: MessageSink<ToWebViewMsgDef>) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const commands = ["kubectl wait for controller-manager"];
        webview.postWaitForControllerManagerResponse(getInstallStepResult(hasError, "wait for controller manager", commands));
    }

    return [
        Scenario.create("aso", "successful", () => <AzureServiceOperator {...initialState} />, webview => getMessageHandler(webview, false), stateUpdater.vscodeMessageHandler),
        Scenario.create("aso", "with errors", () => <AzureServiceOperator {...initialState} />, webview => getMessageHandler(webview, true), stateUpdater.vscodeMessageHandler)
    ];
}