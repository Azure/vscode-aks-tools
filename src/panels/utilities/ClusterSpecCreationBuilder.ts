import { Deployment } from "@azure/arm-resources";

var fs = require('fs');
var path = require('path');

interface ManagedClusterSpecBuilder {
    buildDevTestClusterSpec(clusterSpec: ClusterSpec): Deployment;
    buildProdStandardClusterSpec(clusterSpec: ClusterSpec): Deployment;
    buildProdEconomyClusterSpec(clusterSpec: ClusterSpec): Deployment;
    buildProdEnterpriseClusterSpec(clusterSpec: ClusterSpec): Deployment;
}

export type ClusterSpecType = "devtest" | "prodstandard" | "prodeconomy" | "prodenterprise";

export type ClusterSpec = {
    location: string,
    name: string,
    resourceGroupName: string,
    subscriptionId: string,
    subscriptionName: string
}

export class ClusterSpecBuilder implements ManagedClusterSpecBuilder {
    constructor() { }
    public buildDevTestClusterSpec(clusterSpec: ClusterSpec): Deployment {
        var parameters = {
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
                "value": "2023-08-01" // how to get this value ?
            },
            "nodeResourceGroup": {
                "value": `MC_${clusterSpec.resourceGroupName}_${clusterSpec.name}_${clusterSpec.location}`
            },
            "subscriptionId": {
                "value": "20c6254d-ab44-45c8-8885-ceb54699e1bf" //TODO - pass this value
            },
            "resourceGroupName": {
                "value": clusterSpec.resourceGroupName
            },
            "kubernetesVersion": {
                "value": "1.27.7" // how tp get this value ?
            },
            "clusterIdentity": {
                "value": {
                    "type": "SystemAssigned"
                }
            },
        }


        var deploymentParameters: Deployment = {
            "properties": {
                "parameters": parameters,
                "template": loadTemplate("templates/DevTestCreateCluster.json"),
                "mode": "Incremental"
            }
        };
        return deploymentParameters;
    }
    buildProdStandardClusterSpec(clusterSpec: ClusterSpec): Deployment {
        throw new Error("Method not implemented.");
    }
    buildProdEconomyClusterSpec(clusterSpec: ClusterSpec): Deployment {
        throw new Error("Method not implemented.");
    }
    buildProdEnterpriseClusterSpec(clusterSpec: ClusterSpec): Deployment {
        throw new Error("Method not implemented.");
    }

}

function loadTemplate(templateName: string): any {
    try {
        var templateFilePath = path.resolve(templateName); //TODO - fix this, doesn't resolve correct path
        templateFilePath = "/home/hsubramanian/repos/vscode-aks-tools/src/panels/templates/DevTestCreateCluster.json"
        return JSON.parse(fs.readFileSync(templateFilePath, 'utf8'));
    } catch (error) {

    }
}

