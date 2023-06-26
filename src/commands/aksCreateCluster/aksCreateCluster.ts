import { QuickPickItem, window, CancellationToken, QuickInputButton, Uri } from 'vscode';
import { MultiStepInput } from '../../multistep-helper/multistep-helper';
import { IActionContext } from "@microsoft/vscode-azext-utils";

/**
 * A multi-step input using window.createQuickPick() and window.createInputBox().
 * 
 * This first part uses the helper class `MultiStepInput` that wraps the API for the multi-step case.
 */
export default async function aksCreateCluster(
    context: IActionContext,
    target: any
): Promise<void> {

    class MyButton implements QuickInputButton {
        constructor(public iconPath: { light: Uri; dark: Uri; }, public tooltip: string) { }
    }

    // const createResourceGroupButton = new MyButton({
    //     dark: Uri.file(context.asAbsolutePath('resources/dark/add.svg')),
    //     light: Uri.file(context.asAbsolutePath('resources/light/add.svg')),
    // }, 'Create Resource Group');

    const resourceGroups: QuickPickItem[] = ['vscode-data-function', 'vscode-appservice-microservices', 'vscode-appservice-monitor', 'vscode-appservice-preview', 'vscode-appservice-prod']
        .map(label => ({ label }));


    interface State {
        title: string;
        step: number;
        totalSteps: number;
        resourceGroup: QuickPickItem | string;
        name: string;
        runtime: QuickPickItem;
    }

    async function collectInputs() {
        const state = {} as Partial<State>;
        await MultiStepInput.run(input => inputClusterName(input, state));
        return state as State;
    }

    const title = 'Create AKS Cluster';

    async function inputClusterName(input: MultiStepInput, state: Partial<State>) {
        state.resourceGroup = await input.showInputBox({
            title,
            step: 1,
            totalSteps: 5,
            value: typeof state.resourceGroup === 'string' ? state.resourceGroup : '',
            prompt: 'Choose a unique name for the AKS cluster \n (Valid cluster name is 1 to 63 in length consist of letters, numbers, dash and underscore)',
            validate: validateAKSClusterName,
            shouldResume: shouldResume
        });

        return (input: MultiStepInput) => pickResourceGroup(input, state);
    }

    async function pickResourceGroup(input: MultiStepInput, state: Partial<State>) {
        const pick = await input.showQuickPick({
            title,
            step: 2,
            totalSteps: 5,
            placeholder: 'Pick a resource group',
            items: resourceGroups,
            activeItem: typeof state.resourceGroup !== 'string' ? state.resourceGroup : undefined,
            // buttons: [createResourceGroupButton],
            shouldResume: shouldResume
        });
        if (pick instanceof MyButton) {
            return (input: MultiStepInput) => inputResourceGroupName(input, state);
        }
        state.resourceGroup = pick;
        return (input: MultiStepInput) => inputName(input, state);
    }

    async function inputResourceGroupName(input: MultiStepInput, state: Partial<State>) {
        state.resourceGroup = await input.showInputBox({
            title,
            step: 3,
            totalSteps: 5,
            value: typeof state.resourceGroup === 'string' ? state.resourceGroup : '',
            prompt: 'Choose a unique name for the resource group',
            validate: validateNameIsUnique,
            shouldResume: shouldResume
        });
        return (input: MultiStepInput) => inputName(input, state);
    }

    async function inputName(input: MultiStepInput, state: Partial<State>) {
        const additionalSteps = typeof state.resourceGroup === 'string' ? 1 : 0;
        // TODO: Remember current value when navigating back.
        state.name = await input.showInputBox({
            title,
            step: 3 + additionalSteps,
            totalSteps: 4 + additionalSteps,
            value: state.name || '',
            prompt: 'Choose a unique name for the Application Service',
            validate: validateNameIsUnique,
            shouldResume: shouldResume
        });
        return (input: MultiStepInput) => pickRuntime(input, state);
    }

    async function pickRuntime(input: MultiStepInput, state: Partial<State>) {
        const additionalSteps = typeof state.resourceGroup === 'string' ? 1 : 0;
        const runtimes = await getAvailableRuntimes(state.resourceGroup!, undefined /* TODO: token */);
        // TODO: Remember currently active item when navigating back.
        state.runtime = await input.showQuickPick({
            title,
            step: 3 + additionalSteps,
            totalSteps: 3 + additionalSteps,
            placeholder: 'Pick a runtime',
            items: runtimes,
            activeItem: state.runtime,
            shouldResume: shouldResume
        });
    }

    function shouldResume() {
        // Could show a notification with the option to resume.
        return new Promise<boolean>((resolve, reject) => {
            // noop
        });
    }

    async function validateNameIsUnique(name: string) {
        // ...validate...
        await new Promise(resolve => setTimeout(resolve, 1000));
        return name === 'vscode' ? 'Name not unique' : undefined;
    }

    async function validateAKSClusterName(name: string) {
        // ...validate...
        await new Promise(resolve => setTimeout(resolve, 1000));
        const regexp = new RegExp(/^([a-zA-Z0-9_-]){1,63}$/);
        return !regexp.test(name) ? 'Invalid AKS Cluster Name' : undefined;;
    }

    async function getAvailableRuntimes(resourceGroup: QuickPickItem | string, token?: CancellationToken): Promise<QuickPickItem[]> {
        // ...retrieve...
        await new Promise(resolve => setTimeout(resolve, 1000));
        return ['Node 8.9', 'Node 6.11', 'Node 4.5']
            .map(label => ({ label }));
    }

    const state = await collectInputs();
    window.showInformationMessage(`Creating Application Service '${state.name}'`);
}

const { ContainerServiceClient } = require("@azure/arm-containerservice");
const { DefaultAzureCredential } = require("@azure/identity");

/**
 * This sample demonstrates how to Creates or updates a managed cluster.
 *
 * @summary Creates or updates a managed cluster.
 * x-ms-original-file: specification/containerservice/resource-manager/Microsoft.ContainerService/aks/stable/2023-04-01/examples/ManagedClustersCreate_OSSKU.json
 */
async function createManagedClusterWithOssku() {
  const subscriptionId = process.env["CONTAINERSERVICE_SUBSCRIPTION_ID"] || "subid1";
  const resourceGroupName = process.env["CONTAINERSERVICE_RESOURCE_GROUP"] || "rg1";
  const resourceName = "clustername1";
  const parameters = {
    addonProfiles: {},
    agentPoolProfiles: [
      {
        name: "nodepool1",
        type: "VirtualMachineScaleSets",
        count: 3,
        enableNodePublicIP: true,
        mode: "System",
        osSKU: "AzureLinux",
        osType: "Linux",
        vmSize: "Standard_DS2_v2",
      },
    ],
    autoScalerProfile: { scaleDownDelayAfterAdd: "15m", scanInterval: "20s" },
    diskEncryptionSetID:
      "/subscriptions/subid1/resourceGroups/rg1/providers/Microsoft.Compute/diskEncryptionSets/des",
    dnsPrefix: "dnsprefix1",
    enablePodSecurityPolicy: true,
    enableRbac: true,
    httpProxyConfig: {
      httpProxy: "http://myproxy.server.com:8080",
      httpsProxy: "https://myproxy.server.com:8080",
      noProxy: ["localhost", "127.0.0.1"]
    },
    kubernetesVersion: "",
    linuxProfile: {
      adminUsername: "azureuser",
      ssh: { publicKeys: [{ keyData: "keydata" }] },
    },
    location: "location1",
    networkProfile: {
      loadBalancerProfile: { managedOutboundIPs: { count: 2 } },
      loadBalancerSku: "standard",
      outboundType: "loadBalancer",
    },
    servicePrincipalProfile: { clientId: "clientid", secret: "secret" },
    sku: { name: "Basic", tier: "Free" },
    tags: { archv2: "", tier: "test" },
  };
  const credential = new DefaultAzureCredential();
  const client = new ContainerServiceClient(credential, subscriptionId);
  const result = await client.managedClusters.beginCreateOrUpdateAndWait(
    resourceGroupName,
    resourceName,
    parameters
  );
  console.log(result);
}
