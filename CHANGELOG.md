# Change Log

## [1.3.8]

* Managed cluster rotate certificate feature.
* Support ASO for non-Azure clusters and allow subscription selection.
* Enable delete cluster functionality.
* Update vscode engine version and npm audit fix.

Thank you so much to @rzhang628, @peterbom, @qike-ms, @gambtho and @squillace.

## [1.3.7]

* Kubelogin and AAD AKS Cluster support.
* Delete network and connectivity detector.
* Enable connectivity issues detector.

 Thank you so much to @rzhang628, @peterbom and @squillace.

## [1.3.6]

* Fix for css custom uri to use asWebViewURI.

 Thanks to @rzhang628 and @peterbom.

## [1.3.5]

* Generate periscope links from run ID.
* Kubectl get events feature.
* Update ASO usage to latest.
* Auto updates for Starter Workflow.

 Thanks to @rzhang628 and @peterbom.

## [1.3.4]

* Enable quick and easy way to run some kubectl commands on the selected AKS cluster.
* Add issue templates for better feature and issue management.
* AKS Periscope udpates and fixes.
* Fix for Starter workflow polling mechanism.

 Thanks to @rzhang628 and @peterbom. Special thanks to Scott Hanselman and folks who gave backed or gave idea for enabling kubectl commands as submenu.

## [1.3.3]

* Enable AKS features for USGov Cloud feature.

 Thanks to @rzhang628 and @peterbom.

## [1.3.2]

* Enable AKS start and stop cluster feature.
* Update deprecated vscode-extensionui package.

 Thanks to @rzhang628 and @peterbom.

## [1.3.1]

* Revert update deprecated vscode-extensionui package and AKS start and stop cluster feature.

## [1.3.0]

* Enable AKS start and stop cluster feature.
* Update deprecated vscode-extensionui package.
* Defer CRD-loading for ASO CRDs by moving to NodeContributor implementation.
* Update to latest k8s extension API.
* Update vscode engine.

 Thanks to @rzhang628 and @peterbom.

## [1.2.0]

* VsCode to Azure portal URL forward with referrer parameters.

Thanks to @rzhang628, @chandraneel, @rechevarria and @peterbom.

## [1.1.0]

* Refactor to support AKS Periscope Windows changes.
* Enabling create AKS cluster from azure portal.

Thanks to @rzhang628 and @peterbom.

## [1.0.0]

* Enabling show cluster properties feature.
* Extension is now out of preview.

Thanks to @rzhang628 and @peterbom for reviews.

## [0.0.19]

* Enabling show in azure portal usability feature.

Thanks to @rzhang628 and @peterbom for reviews.

## [0.0.18]

* Integrating Known Issues, Availability and Performance detector.
* ASO V2 windows grep command fix.

Thanks to @rzhang628 and @peterbom.

## [0.0.17]

* Integrating Node Health detector.
* Upgrade feature [Azure Service Opertaor V2 feature](https://azure.github.io/azure-service-operator/#installation).
* Starter workflow upgrade for auto PR.

Thanks to @rzhang628, @peterbom and @OliverMKing.

## [0.0.16]

* Addition of Create Github Workflow Submenu.
* Ability to Create AKS Starter Workflow, Helm Workflow, Kompose Worlflow and Kustomize Workflow.

Thanks to @palma21, @qpetraroia, @OliverMKing, @tbarnes94, @peterbom, @gambtho and @rzhang628.

## [0.0.15]

* Refactor to ease creation of new commands.
* Fix aks-periscope deprecated beta tag.
* Integrating Best Practices detector.
* Integrate Identity and security diagnostics

Thanks to @rzhang628, @peterbom.

## [0.0.14]

* Retiring [deploy-to-azure extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-deploy-azure.azure-deploy) CI/CD commands.
* AKS Diagnostics Enable CRUD detectors and code move around.

Thanks to @peterbom, @rzhang628, @bishal-pdMSFT, @bnookala and @squillace.

## [0.0.13]

* Create [GitHub AKS Starter Workflow](https://github.com/actions/starter-workflows/blob/main/deployments/azure-kubernetes-service.yml).

Thanks to @gambtho, @peterbom, @OliverMKing, @qike-ms, @itowlson, @rzhang628, @davefellows, @squillace and @qpetraroia

## [0.0.12]

* Fix for periscope feature and update depricated api version from beta1 to v1.
* New badges for this repo and message display changes for periscope.

Thanks to @rzhang628, @davefellows, @squillace, @itowlson

## [0.0.11]

* Changes to incorporate new Azure Service Operator changes. (#90)

Thanks to @itowlson, @rzhang628, @babbageclunk

## [0.0.10]

* Support Workspace Trust feature (#71)
* Update icon to latest design (#83)
* Fix storage SDK issue under VS Code 1.59 (#81)
* Mark as supporting virtual workspaces (#77)
* Webpack the extension (#62)
* Periscope work for kustomise related changes (#82)
* Fix packaging failure (#84)
* Remove unused package and update handlebars (#85)
* GitHub action to release and publish (#86)

Thanks to @itowlson, @AaronCrawfis and @qpetraroia.

## 0.0.9

* Install [Azure Service Operator](https://cloudblogs.microsoft.com/opensource/2020/06/25/announcing-azure-service-operator-kubernetes/) and browse Azure service resources

Thanks to Tatsat Mishra and Yun Jung Choi.

## 0.0.8

* Integration with [Deploy to Azure](https://marketplace.visualstudio.com/items?itemName=ms-vscode-deploy-azure.azure-deploy) extension.
* Fixed a typo.

Thanks to Tatsat Mishra, Kanika Pasrija and Pulkit Agarwal.

## 0.0.7

* You can now get AKS Periscope diagnostic information for your clusters.
* Fixed getting kubeconfig under Azure RBAC
* Shiny new icon for your AKS clusters!

Thanks to Tatsat Mishra.

## 0.0.6

* You can now get AppLens cluster diagnostics by right-clicking in Cloud Explorer.
* We now have a marketplace icon.

Thanks to Ronan Flynn-Curran, Phillip Hoff and Tatsat Mishra.

## 0.0.5

Unreleased

## 0.0.4

* Flushed a regression. No, I don't know what this did either.

## 0.0.3

* Fixed subscription icon not displayed in marketplace build.

Thanks to Phillip Hoff.

## 0.0.2

* Improved Azure account integration and login experience.

Thanks to Phillip Hoff.

## 0.0.1

* Show AKS clusters in Kubernetes extension's Cloud Explorer
