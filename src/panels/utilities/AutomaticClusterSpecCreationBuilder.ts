import { Deployment } from "@azure/arm-resources";
import { Preset } from "../../webview-contract/webviewDefinitions/createCluster";
import automaticClusterTemplate from "../templates/AKSAutomaticCreateCluster.json";

export type AutomaticAKSClusterSpec = {
    location: string;
    name: string;
    resourceGroupName: string;
    subscriptionId: string;
};

type TemplateContent = Record<string, unknown> | undefined;

const deploymentApiVersion = "2023-08-01";
const presetTemplates: Record<Preset, TemplateContent> = {
    dev: undefined,
    automatic: automaticClusterTemplate
};

export class AutomaticClusterDeploymentBuilder {
    private deployment: Deployment = {
        properties: {
            parameters: {},
            template: {},
            mode: "Incremental",
        },
    };

    public buildCommonParameters(clusterSpec: AutomaticAKSClusterSpec): AutomaticClusterDeploymentBuilder {
        this.deployment.properties.parameters = {
            ...this.deployment.properties.parameters,
            location: {
                value: clusterSpec.location,
            },
            resourceName: {
                value: clusterSpec.name,
            },
            apiVersion: {
                value: deploymentApiVersion,
            },
            nodeResourceGroup: {
                value: generateNodeResourceGroup(clusterSpec.resourceGroupName, clusterSpec.name, clusterSpec.location),
            },
            subscriptionId: {
                value: clusterSpec.subscriptionId,
            },
            resourceGroupName: {
                value: clusterSpec.resourceGroupName,
            },
            clusterIdentity: {
                value: {
                    type: "SystemAssigned",
                },
            }
        };

        return this;
    }

    public buildTemplate(preset: Preset) {
        this.deployment.properties.template = presetTemplates[preset];
        return this;
    }

    public getDeployment(): Deployment {
        return this.deployment;
    }
}

function generateNodeResourceGroup(resourceGroupName: string, clusterName: string, location: string): string {
    const sanitizedResourceGroupName = removeWhitespace(resourceGroupName);
    const sanitizedClusterName = removeWhitespace(clusterName);
    const sanitizedLocation = removeWhitespace(location);
    return `MC_${sanitizedResourceGroupName}_${sanitizedClusterName}_${sanitizedLocation}`.substring(0, 80);
}

function removeWhitespace(str: string): string {
    return str.replace(/\s+/g, "");
}
