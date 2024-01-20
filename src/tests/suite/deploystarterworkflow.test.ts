import * as configureStarterWorkflow from "../../commands/utils/configureWorkflowHelper";
import "sinon";
import { Succeeded, succeeded } from "../../commands/utils/errorable";

describe("Test getWorkflowYaml for missing file", () => {
    it("should return an error", () => {
        const result = configureStarterWorkflow.getWorkflowYaml("this-template-does-not-exist");
        import("chai").then(chai => chai.expect(succeeded(result)).to.be.false);
    });
});

const knownWorkflowNames = [
    "azure-kubernetes-service",
    "azure-kubernetes-service-helm",
    "azure-kubernetes-service-kompose",
    "azure-kubernetes-service-kustomize",
];

describe("Test getWorkflowYaml for known files", () => {
    it("should return string content with expected placeholders", () => {
        knownWorkflowNames.forEach((workflowName) => {
            const result = configureStarterWorkflow.getWorkflowYaml(workflowName);
            import("chai").then(chai => chai.expect(succeeded(result)).to.be.true);
            const content = (result as Succeeded<string>).result;
            import("chai").then(chai => chai.expect(content).to.contain(
                'RESOURCE_GROUP: "your-resource-group"',
                `resource group placeholder missing from ${workflowName}`,
            ));
            import("chai").then(chai => chai.expect(content).to.contain(
                'CLUSTER_NAME: "your-cluster-name"',
                `cluster name placeholder missing from ${workflowName}`,
            ));
            import("chai").then(chai => chai.expect(content).not.to.contain(
                "<RESOURCE_GROUP>",
                `incorrect placeholder <RESOURCE_GROUP> in ${workflowName}`,
            ));
            import("chai").then(chai => chai.expect(content).not.to.contain("<CLUSTER_NAME>", `incorrect placeholder <CLUSTER_NAME> in ${workflowName}`));
        });
    });
});

describe("Test substituteClusterInWorkflowYaml", () => {
    it("should return arguments in output", () => {
        const initialYamlContent = `
env:
  AZURE_CONTAINER_REGISTRY: "your-azure-container-registry"
  CONTAINER_NAME: "your-container-name"
  RESOURCE_GROUP: "your-resource-group"
  CLUSTER_NAME: "your-cluster-name"
  IMAGE_PULL_SECRET_NAME: "your-image-pull-secret-name"
  KUSTOMIZE_PATH: "your-kustomize-path"
`;

        const testResourceGroup = "test-resource-group";
        const testClusterName = "test-cluster";
        const result = configureStarterWorkflow.substituteClusterInWorkflowYaml(
            initialYamlContent,
            testResourceGroup,
            testClusterName,
        );
        import("chai").then(chai => chai.expect(result).to.contain(`RESOURCE_GROUP: "${testResourceGroup}"`));
        import("chai").then(chai => chai.expect(result).to.contain(`CLUSTER_NAME: "${testClusterName}"`));
    });
});
