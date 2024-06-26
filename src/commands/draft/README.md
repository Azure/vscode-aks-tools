# Draft Commands (Automated Deployments)

These commands make use of the [Draft tool](https://github.com/Azure/draft) to allow users to generate build, deployment and workflow files in their local workspace. Starting with a locally running application, the aim is to add the necessary configuration files to containerize and deploy the application to an AKS cluster from GitHub.

## Parity (or lack thereof) with Automated Deployments

Automated Deployments is a service provided by the Azure Portal with a similar objective. Users can choose an existing project on GitHub, and Automated Deployments will create a PR containing the configuration files. It also sets up the GitHub secrets, Entra ID application and role assignments needed to authorize the workflow to publish to an ACR and deploy to an AKS cluster.

Once Automated Deployments has been run and the PR containing the GitHub workflow file has been created, that workflow is 'known' to Automated Deployments. It can report on the status of the PR, as well as workflow runs once the PR has been merged. This has possible future potential for allowing updates to that workflow for deploying other related resources like ingresses.

The aim with integrating Draft in this extension is to provide the ability to construct the same Dockerfiles, Kubernetes deployment manifests and GitHub workflow files that Automated Deployments does, but in the user's local file system. We assume users will have their own systems and processes for branching, committing, reviewing, pushing and merging code changes. Therefore, we _do not want_ to automatically create PRs in the way that Automated Deployments does so.

| Feature | AKS Extension with Draft | Automated Deployments |
|---|---|---|
| Create Dockerfile | :heavy_check_mark: | :heavy_check_mark: |
| Create deployment manifest | :heavy_check_mark: | :heavy_check_mark: |
| Create GitHub workflow | :heavy_check_mark: [^1] | :heavy_check_mark: |
| Create PR | :x: | :heavy_check_mark: |
| Remember workflow (store as 'known' workflow for future reference) | :x: | :heavy_check_mark: |
| Attach ACR to cluster | :heavy_check_mark: [^2] | :heavy_check_mark: |
| Authorize GitHub workflow | :x: [^3] | :heavy_check_mark: |
| Review and delete ACR attachments | :heavy_check_mark: [^4] | :x: |
| Review and delete GitHub workflow authorizations | :x: [^5] | :x: |

Automated Deployments is implemented primarily by the [DevHub RP](https://github.com/Azure/azure-rest-api-specs/tree/main/specification/developerhub/resource-manager/Microsoft.DevHub/stable), but some important functionality is managed directly by the Azure Portal.

In particular, the Portal is responsible for most of the authorization work. This includes:
- attaching the ACR to the cluster (adding AcrPull role assignments)
- creating an Entra ID application and ensuring its Service Principal has permission to publish images to the ACR and deploy Kubernetes resources to the cluster
- configuring federated identity credentials for the Entra ID application so that it can be used by the GitHub workflow.

### Draft Limitations

Draft's command to generate GitHub workflow files is not sufficiently configurable to support workflow generation comparable to Automated Deployments. It does not support:
- different resource groups for ACR and cluster
- the location of the deployment files that's different from the repo root (for repositories containing more than one microservice)
- the cluster namespace to deploy to

The `draft info` command [lacks some language-related metadata](https://github.com/Azure/draft/issues/266) that would enable us to present a more intuitive UX for Dockerfile generation. Currently:
- It does not allow us to default the port number based on the language, as the Portal experience does.
- It provides sample image _tags_ (versions) for the builder and runtime images of each language, but it does not state which _image_ these tags are for.

This necessitates some [hard-coded language metadata](./languages.ts), which would ideally be retrieved dynamically from Draft.

## Workflow file generation

Since we are not using Draft for constructing GitHub workflow files, we needed an alternative approach for creating files based on templates.

Our implementation here uses dedicated VS Code API methods that are designed for inserting/updating specific ranges of text, preserving the rest of the document and playing nicely with core editor functionality like undo. This would be hard to achieve using a naive YAML parser/formatter.

The template files are defined as resources in the AKS extension repository, and we use the VS Code [WorkspaceEdit](https://code.visualstudio.com/api/references/vscode-api#WorkspaceEdit) and [DocumentSymbol](https://code.visualstudio.com/api/references/vscode-api#DocumentSymbol) APIs for performing the substitutions.

This provides a proof-of-concept of how we might perform other code manipulation functionality for scenarios that may not involve Draft. An example might be identifying parts of Kubernetes manifests that don't adhere to best practices and adding the ability to update just those parts.

Future scenarios would obviously require more work, but the [baseWorkflowEditor.ts](./baseWorkflowEditor.ts) file provides a starting point for how we might build some domain-specific code editing functionality.

## Future maintenance and feature work

**Remove duplication of effort in generating workflow files.**

We now store GitHub workflow file templates in at least three places: Draft, DevHub and this extension. We could resolve this by either:
- Updating Draft to support the same workflow files generated by Automated Deployments; or
- Maintaining public template files which could be consumed by Draft, DevHub and the AKS extension, allowing independent versioning of those files.

**Enhance `draft info` output**.

Being able to [retrieve the image names for builder and runtime images](https://github.com/Azure/draft/issues/266#issuecomment-2053910528) would permit dynamic tag retrieval, meaning less frequent updates to Draft when new language versions are released.

**GitHub workflow authorization**

This work is tracked [here](https://github.com/Azure/vscode-aks-tools/issues/253), with a proof-of-concept currently in a [branch](https://github.com/peterbom/vscode-aks-tools/tree/feature/gh-workflow-authz).

**DevHub integration for workflows**

GitHub workflows that are created in our extension are currently not visible in Automated Deployments. At the moment this is not much of a hindrance, because VS Code users already have more familiar ways of viewing workflow runs than navigating to an Azure Portal blade.

However, it's conceivable that the workflow objects in the Portal could be used as the context for _other_ AKS functionality like adding new Kubernetes resources to the deployments. If this turns out to be the case we would want to be able to store workflows created from this extension in the same manner.

The DevHub RP _almost_ supports this, but not quite. To enable that, the RP would need to support a variation of [PUT workflow](https://github.com/Azure/azure-rest-api-specs/blob/main/specification/developerhub/resource-manager/Microsoft.DevHub/stable/2023-08-01/workflow.json) in which only the workflow object itself was mandatory (not the PR or the GitHub credentials).

[^1]: This does not currently use Draft (see limitations above).
[^2]: This functionality is available in the AKS extension with a separate command.
[^3]: A PoC of this functionality exists as a [branch](https://github.com/peterbom/vscode-aks-tools/tree/feature/gh-workflow-authz).
[^4]: This functionality is available in the AKS extension with a separate command.
[^5]: A PoC of this functionality exists as a [branch](https://github.com/peterbom/vscode-aks-tools/tree/feature/gh-workflow-authz).
