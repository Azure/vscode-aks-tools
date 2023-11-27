import { Deployment } from "@azure/arm-resources";

import fs from 'fs';
import path from 'path';

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
    kubernetesVersion: string
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
                "template": loadTemplate("DevTestCreateCluster.json"),
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
                "template": loadTemplate("DevTestCreateCluster.json"),
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
            },
        }

        const deploymentParameters: Deployment = {
            "properties": {
                "parameters": parameters,
                "template": loadTemplate("DevTestCreateCluster.json"),
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
                "template": loadTemplate("DevTestCreateCluster.json"),
                "mode": "Incremental"
            }
        };
        return deploymentParameters;
    }

}

//eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadTemplate(templateName: string): any {
    try {
        //const templateFilePath = path.resolve(templateName); //TODO - fix this, doesn't resolve correct path
        //templateFilePath = "/home/hsubramanian/repos/vscode-aks-tools/src/panels/templates/DevTestCreateCluster.json"
        const templateFilePath = path.join(__dirname, 'src', 'panels', 'templates', templateName);
        return JSON.parse(fs.readFileSync(templateFilePath, 'utf8'));
    } catch (error) {
        console.log(error);
        throw error;
    }
}

