import { Deployment } from "@azure/arm-resources";
import devTestTemplate from '../templates/DevTestCreateCluster.json';

interface ManagedClusterSpecBuilder {
    buildDevTestClusterSpec(clusterSpec: ClusterSpec): Deployment;
    buildProdStandardClusterSpec(clusterSpec: ClusterSpec): Deployment;
    buildProdEconomyClusterSpec(clusterSpec: ClusterSpec): Deployment;
    buildProdEnterpriseClusterSpec(clusterSpec: ClusterSpec): Deployment;
}

export type ClusterSpec = {
    location: string,
    name: string,
    resourceGroupName: string,
    subscriptionId: string,
    kubernetesVersion: string,
    username: string
}

export class ClusterSpecBuilder implements ManagedClusterSpecBuilder {
    private static apiVersion: string = "2023-08-01";
    constructor() { }
    public buildDevTestClusterSpec(clusterSpec: ClusterSpec): Deployment {
        const parameters = {
            "location": {
                "value": clusterSpec.location
            },
            "resourceName": {
                "value": clusterSpec.name
            },
            "dnsPrefix": {
                "value": generateDnsPrefix(clusterSpec.name)
            },
            "apiVersion": {
                "value": ClusterSpecBuilder.apiVersion
            },
            "nodeResourceGroup": {
                "value": generateNodeResourceGroup(clusterSpec.resourceGroupName, clusterSpec.name, clusterSpec.location)
            },
            "subscriptionId": {
                "value": clusterSpec.subscriptionId
            },
            "resourceGroupName": {
                "value": clusterSpec.resourceGroupName
            },
            "kubernetesVersion": {
                "value": clusterSpec.kubernetesVersion
            },
            "clusterIdentity": {
                "value": {
                    "type": "SystemAssigned"
                }
            },
            "userEmailAddress": {
                value: clusterSpec.username
            }
        }


        const deploymentParameters: Deployment = {
            "properties": {
                "parameters": parameters,
                "template": devTestTemplate,
                "mode": "Incremental"
            }
        };
        return deploymentParameters;
    }

    buildProdStandardClusterSpec(clusterSpec: ClusterSpec): Deployment {
        //TODO - implement this
        const parameters = {
            "location": {
                "value": clusterSpec.location
            },
            "resourceName": {
                "value": clusterSpec.name
            },
            "dnsPrefix": {
                "value": `${clusterSpec.name}-dns`
            },
            "apiVersion": {
                "value": ClusterSpecBuilder.apiVersion
            },
            "nodeResourceGroup": {
                "value": `MC_${clusterSpec.resourceGroupName}_${clusterSpec.name}_${clusterSpec.location}`
            },
            "subscriptionId": {
                "value": clusterSpec.subscriptionId
            },
            "resourceGroupName": {
                "value": clusterSpec.resourceGroupName
            },
            "kubernetesVersion": {
                "value": clusterSpec.kubernetesVersion
            },
            "clusterIdentity": {
                "value": {
                    "type": "SystemAssigned"
                }
            },
        }

        const deploymentParameters: Deployment = {
            "properties": {
                "parameters": parameters,
                "template": devTestTemplate, //TODO - change this to the correct template
                "mode": "Incremental"
            }
        };
        return deploymentParameters;
    }

    buildProdEconomyClusterSpec(clusterSpec: ClusterSpec): Deployment {
        //TODO - implement this
        const parameters = {
            "location": {
                "value": clusterSpec.location
            },
            "resourceName": {
                "value": clusterSpec.name
            },
            "dnsPrefix": {
                "value": `${clusterSpec.name}-dns`
            },
            "apiVersion": {
                "value": ClusterSpecBuilder.apiVersion
            },
            "nodeResourceGroup": {
                "value": `MC_${clusterSpec.resourceGroupName}_${clusterSpec.name}_${clusterSpec.location}`
            },
            "subscriptionId": {
                "value": clusterSpec.subscriptionId
            },
            "resourceGroupName": {
                "value": clusterSpec.resourceGroupName
            },
            "kubernetesVersion": {
                "value": clusterSpec.kubernetesVersion
            },
            "clusterIdentity": {
                "value": {
                    "type": "SystemAssigned"
                }
            }
        }

        const deploymentParameters: Deployment = {
            "properties": {
                "parameters": parameters,
                "template": devTestTemplate, //TODO - change this to the correct template
                "mode": "Incremental"
            }
        };
        return deploymentParameters;
    }

    buildProdEnterpriseClusterSpec(clusterSpec: ClusterSpec): Deployment {
        //TODO - implement this
        const parameters = {
            "location": {
                "value": clusterSpec.location
            },
            "resourceName": {
                "value": clusterSpec.name
            },
            "dnsPrefix": {
                "value": `${clusterSpec.name}-dns`
            },
            "apiVersion": {
                "value": ClusterSpecBuilder.apiVersion
            },
            "nodeResourceGroup": {
                "value": `MC_${clusterSpec.resourceGroupName}_${clusterSpec.name}_${clusterSpec.location}`
            },
            "subscriptionId": {
                "value": clusterSpec.subscriptionId
            },
            "resourceGroupName": {
                "value": clusterSpec.resourceGroupName
            },
            "kubernetesVersion": {
                "value": clusterSpec.kubernetesVersion
            },
            "clusterIdentity": {
                "value": {
                    "type": "SystemAssigned"
                }
            },
        }

        const deploymentParameters: Deployment = {
            "properties": {
                "parameters": parameters,
                "template": devTestTemplate, //TODO - change this to the correct template
                "mode": "Incremental"
            }
        };
        return deploymentParameters;
    }

}

function generateDnsPrefix(clusterName: string): string {
    // this replaces all white spaces in the string
    clusterName = clusterName.replace(/\s+/g, '');
    return validateDnsPrefix(clusterName);
}

function validateDnsPrefix(dnsPrefix: string): string {
    // please refer https://aka.ms/aks-naming-rules
    dnsPrefix.length > 54 ? dnsPrefix.substring(0, 54) : dnsPrefix;
    const dnsPrefixRegex = /^[a-z0-9](?:[a-z0-9\-]{0,52}[a-z0-9])?$/i;
    if (!dnsPrefixRegex.test(dnsPrefix)) {
        throw new Error("Invalid DNS prefix. The DNS prefix must start and end with alphanumeric values, be between 1-54 characters in length, and can only include alphanumeric values and hyphens ('-'). Special characters, such as periods ('.'), are not allowed.");
    }
    return dnsPrefix;
}

function generateNodeResourceGroup(resourceGroupName: string, clusterName: string, location: string): string {
    const sanitizedResourceGroupName = removeWhitespace(resourceGroupName);
    const sanitizedClusterName = removeWhitespace(clusterName);
    const sanitizedLocation = removeWhitespace(location);
    const nodeResourceGroup = `MC_${sanitizedResourceGroupName}_${sanitizedClusterName}_${sanitizedLocation}`;
    return validateNodeResourceGroup(nodeResourceGroup);
}

function validateNodeResourceGroup(nodeResourceGroup: string): string {
    // please refer https://aka.ms/aks-naming-rules
    return nodeResourceGroup.length > 80 ? nodeResourceGroup.substring(0, 80) : nodeResourceGroup;
}

function removeWhitespace(str: string): string {
    return str.replace(/\s+/g, '');
}

