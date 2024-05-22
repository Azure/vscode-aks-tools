# Change Log

## [1.4.5]

* Fix treeview stuck with only 'select tenant' node.
* Add Draft Dockerfile, Deployment and Workflow commands.
* Fix bump vscode 1.89 update.
* Dependabot updates and bumps.

Thank you so much to @peterbom, @qpetraroia, @hsubramanianaks for Draft work, testing this and for review comments.

## [1.4.4]

* Azure Account Sign-In Changes.
* Dependabot updates and bumps.

Thank you so much @peterbom for continued effort login improvement, thanks you so much to @qpetraroia,   @hsubramanianaks for testing this and for comments, special mention to both @TylerLeonhardt and @alexweininger for collaborations. Thanks all for our other BAU contributors.

## [1.4.3]

* Retina integration with VsCode.
* In-house download replacement implementation.
* Show-properties page k8s version is now available with deprecated warning.
* Dependabot updates and bumps.

Thank you so much @sprab for continued effort for Retina User-Sceanrios testing changes, thanks you so much to  @hsubramanianaks for Retina help and U/X changes, thanks to, @sprab, @hsubramanianaks, & @peterbom for comments and testing. Thank you @rbtr and @vakalapa for async Retina Fixes and for `0.0.7` release. Thanks all for our other BAU contributors.

## [1.4.2]

* Show Properties page new feature for help information with k8s version deprecated available .
* Replace download package with more in-house implementation.
* Eslint improvement, Inspektor Gadget update.
* Handle new archive structure for IG in windows.
* Dependabot updates.

Thank you so much @sprab for continued effort for testing changes, thanks you, @peterbom & our other BAU contributors.

## [1.4.1]

* Fix for making instance when cluster name is same but RG are different.
* Changes in correlation with new GH Action Permission Changes.
* Add badge for codeql and chai test fix.
* Add codeql analysis for repo.
* Add bestpractices progress and other badges.
* Dependabot updates.

Thank you so much @sprab for continued effort for testing changes for unique name fix and testing other feature, thanks @hsubramanianaks, @peterbom for reviews, collaboration. Thank you everyone who indirectly helped in building in any ideas for this release!

## [1.4.0]

* Run Eraser Tool on AKS Cluster.
* Add refreshSubscription command to aksCreateCluster and aksDeleteCluster.
* Refactor AzureAccountTreeItem and related files.
* Simplify webview dev task problem matcher.
* Refresh subscription.
* Update launch.json and tasks.json for webpack-dev.
* Use new telemetry library.
* Support telemetry for commands from webviews.
* Dependabot updates.

Thank you so much @sprab, @peterbom for feature work, collaboration and making this tool continuously better. Thank you everyone who indirectly helped in building in any ideas for this release!

## [1.3.18]

* Compare 2 AKS Cluster.
* Add Filters to TCP Dump.
* Enhance Create Cluster and designed U/X experience.
* Refactors like Portal URL, Fixing Old Dependencies, Occassional Errors for npm.
* Add outfiles to webview UI launch config.
* Update vscode engine and vscode type for this repo.

Thank you so much to our awesome designer help by @ivelisseca and to @sprab, @peterbom, @hsubramanianaks and @qpetraroia. Special thanks to countless folks who reach out to us and help us in improving with ideas. I would also extend huge thanks to indirect collaboration for tcp-dump enhanced filter with Qi, Prabha, Tom, June, Yi, Weinong's email, Thank you all for your ideas!

## [1.3.17]

* Upgrade azext-utils and related packages.
* Feature: agent pool abort last operation.
* Feature: abort/reconcile cluster operation in show properties page.
* Fix the filePath as empty issue. (TCP Dump Issue)
* Fix vscode engine update.
* Add dependabot file.
* Dependabot updates.
* Clean up unused or unnecessary dependencies.

Collaborations and thanks to @peterbom.

## [1.3.16]

* Collect TCP Dump.
* Move last webview (cluster properties) to webview project.
* Simplify state management for new webviews.
* Reconcile cluster using update.
* Download Draft Binaries PR.
* Remove deprecated React function call and update webview-ui dependencies.
* Dependent bot updates.

Thank you so much to @peterbom, @sprab, @hsubramanianaks and @qpetraroia. Special thanks to countless folks who reach out to us and help us in improving with ideas. I would also extend huge thanks to indirect collaboration with Qi, June, Suli, Yi, Tom, Indu, Sri, Prabha, Thank you all for your ideas and collaboration! 

## [1.3.15]

* Avoid lengthy kubectl output changing the layout of containing elements.
* Handle explicit state for poller.
* Abort last operation on cluster.
* Remove the unsed method.
* Implement Create Cluster as WebView.
* Add state management.
* Update ASO version and move to webview-ui project.
* Fix comon id issue.
* Default branch is now main.
* Move kubectl commands to webview.

Thank you so much to @peterbom, @hsubramanianaks and @qpetraroia. Special thanks to countless folks who reach out to us and help us in improving with ideas. I would also extend huge thanks to indirect collaboration with Qi, June, Yi, Tom, Indu, Sri, Prabha, Chase, Thank you all for your ideas! 

## [1.3.14]

* Update Kubelogin version to use latest.
* Upgrade ARM resources library.
* Feature welcome workflow.
* Feature customise kubectl command.
* Simplify definitions of messages and handlers for webviews.
* Fix debug background task problem matcher.
* Reorganize type structure of webview definitions.
* Move all Inspektor Gadget commands to single Webview.

Thank you so much to @peterbom, @hsubramanianaks and @qpetraroia.

## [1.3.13]

* Enabling create cluster.
* Add webview component for detectors.
* Fix spelling of "snapshot" in menus.

Thank you so much to @FineTralfazz, @rzhang628, @peterbom, @gambtho and @qpetraroia.

## [1.3.12]

* Remove unnecessary kubelogin download.
* Allow development of VS Code-themed webviews using UI toolkit and React framework.
* Update Periscope deployment to latest version.
* Remove deprecated activation events.
* Publish gh.io readme as a vscode documentation.
* Link the GH pages to the Readme doc of this repo.

Thank you so much to @rzhang628, @peterbom.

## [1.3.11]

* Enable Non-Interactive InspektorGadget Commands like Top, Profile and Snapshot.
* Enable ChatGPT review pipeline for the repo.

Thank you so much to @rzhang628, @peterbom, @qike-ms, @gambtho, @squillace, @mauriciovasquezbernal and @blanquicet.

## [1.3.10]

* Enable deploy/undeploy inspektor gadget.
* Add k8s api healtch check submenu.

Thank you so much to @rzhang628, @peterbom, and @blanquicet.

## [1.3.9]

* Remove SVG Badges which Marketplace didn't like.
* Managed cluster rotate certificate feature.
* Support ASO for non-Azure clusters and allow subscription selection.
* Enable delete cluster functionality.
* Update vscode engine version and npm audit fix.

Thank you so much to @rzhang628, @peterbom, @qike-ms, @gambtho and @squillace.

## [1.3.8]

* Abandoned Please refer to release 1.3.9

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
