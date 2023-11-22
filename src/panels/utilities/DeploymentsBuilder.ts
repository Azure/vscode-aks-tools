import { Deployment } from "@azure/arm-resources";

interface DeploymentsBuilder {
    buildDevTestDeploymentSpec(): Deployment;
    buildProdStandardDeploymentSpec(): Deployment;
    buildProdEconomyDeploymentSpec(): Deployment;
    buildProdEnterpriseDeploymentSpec(): Deployment;
}

export class DeploymentSpecBuilder implements DeploymentsBuilder {
    constructor() { }
    buildDevTestDeploymentSpec(): Deployment {
        return {
            properties: {
                template: {
                    $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
                    contentVersion: "1.0.0.0",
                    resources: [
                        {
                            "type": "microsoft.insights/actionGroups",
                            "apiVersion": "2022-06-01",
                            "name": "RecommendedAlertRules-AG-11",
                            "location": "Global",
                            "properties": {
                                "groupShortName": "recalert11",
                                "enabled": true,
                                "emailReceivers": [
                                    {
                                        "name": "Email_-EmailAction-",
                                        "emailAddress": "hsubramanian@microsoft.com", //TODO: Get this from the user
                                        "useCommonAlertSchema": true
                                    }
                                ],
                                "emailSMSAppReceivers": []
                            }
                        }
                    ],
                },
                parameters: {},
                mode: "Incremental"
            }
        };
    }
    buildProdStandardDeploymentSpec(): Deployment {
        throw new Error("Method not implemented.");
    }
    buildProdEconomyDeploymentSpec(): Deployment {
        throw new Error("Method not implemented.");
    }
    buildProdEnterpriseDeploymentSpec(): Deployment {
        throw new Error("Method not implemented.");
    }

}