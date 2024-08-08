import { Deployment } from "@azure/arm-resources";
import { Preset } from "../../webview-contract/webviewDefinitions/createCluster";
import devTestTemplate from "../templates/DevTestCreateCluster.json";
import automaticTemplate from "../templates/AutomaticCreateCluster.json";

export type ClusterSpec = {
    location: string;
    name: string;
    resourceGroupName: string;
    subscriptionId: string;
    kubernetesVersion: string;
    username: string;
};

type TemplateContent = Record<string, unknown>;

const deploymentApiVersion = "2023-08-01";
const deploymentApiVersionPreview = "2024-03-02-preview";
const presetTemplates: Record<Preset, TemplateContent> = {
    dev: devTestTemplate,
    automatic: automaticTemplate,
};

export class ClusterDeploymentBuilder {
    private deployment: Deployment = {
        properties: {
            parameters: {},
            template: {},
            mode: "Incremental",
        },
    };

    public buildCommonParameters(clusterSpec: ClusterSpec, preset: Preset): ClusterDeploymentBuilder {
        this.deployment.properties.parameters = {
            ...this.deployment.properties.parameters,
            location: {
                value: clusterSpec.location,
            },
            resourceName: {
                value: clusterSpec.name,
            },
            dnsPrefix: {
                value: generateDnsPrefix(clusterSpec.name),
            },
            apiVersion: {
                value: preset == "automatic" ? deploymentApiVersionPreview : deploymentApiVersion,
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
            kubernetesVersion: {
                value: clusterSpec.kubernetesVersion,
            },
            clusterIdentity: {
                value: {
                    type: "SystemAssigned",
                },
            },
            userEmailAddress: {
                value: clusterSpec.username,
            },
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

function generateDnsPrefix(clusterName: string): string {
    return clusterName
        .replaceAll(/[^a-z0-9-\\s]/gi, "")
        .replace(/^-/, "")
        .replace(/-$/, "")
        .substring(0, 54);
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
