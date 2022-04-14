import * as configureStarterWorkflow  from '../../commands/utils/configureWorkflowHelper';
import 'sinon';
import { expect } from 'chai';
import { Succeeded, succeeded } from '../../commands/utils/errorable';

describe('Test getWorkflowYaml for missing file', () => {
  it('should return an error', () => {
    const result = configureStarterWorkflow.getWorkflowYaml("this-template-does-not-exist");
    expect(succeeded(result)).to.be.false;
  });
});

describe('Test getWorkflowYaml for known files', () => {
  it('should return string content with expected placeholders', () => {
    ["azure-kubernetes-service",
    "azure-kubernetes-service-helm",
    "azure-kubernetes-service-kompose",
    "azure-kubernetes-service-kustomize"].forEach(workflowName => {
      const result = configureStarterWorkflow.getWorkflowYaml(workflowName);
      expect(succeeded(result)).to.be.true;
      expect((result as Succeeded<string>).result).to.contain('RESOURCE_GROUP: "your-resource-group"', `resource group placeholder missing from ${workflowName}`);
      expect((result as Succeeded<string>).result).to.contain('CLUSTER_NAME: "your-cluster-name"', `cluster name placeholder missing from ${workflowName}`);
    });
  });
});

describe('Test substituteClusterInWorkflowYaml', () => {
  it('should return arguments in output', () => {
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
    const result = configureStarterWorkflow.substituteClusterInWorkflowYaml(initialYamlContent, testResourceGroup, testClusterName);
    expect(result).to.contain(`RESOURCE_GROUP: "${testResourceGroup}"`);
    expect(result).to.contain(`CLUSTER_NAME: "${testClusterName}"`);
  });
});
