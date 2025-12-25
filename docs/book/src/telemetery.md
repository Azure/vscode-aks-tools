# Telemetry

## Telemetry

This extension collects telemetry data to help us build a better experience for building applications with Azure Kubernetes Service and VS Code. We only collect the following data:

* Which commands are executed.
* Events pertaining to GitHub Copilot for Azure (@azure) handlers
    * Which VS Code command ID was used to enable handler
    * Whether or not if a subscription was selected
    * Whether or not a manifest file was selected
    * Whether or not a cluster was selected
    * Which cluster option was selected (see `SelectClusterOptions` type)
    * Whether or not a manifest deployment was cancelled
    * Whether or not a manifest deployment was successful
    * Whether or not the success manifest deployment link was clicked
    * Whether or not a cluster was successfully created

We do not collect any information about image names, paths, etc. Read our [privacy statement](https://privacy.microsoft.com/privacystatement) to learn more. If you don’t wish to send usage data to Microsoft, you can set the `telemetry.enableTelemetry` setting to `false`. Learn more in our [FAQ](https://code.visualstudio.com/docs/supporting/faq#_how-to-disable-telemetry-reporting).
