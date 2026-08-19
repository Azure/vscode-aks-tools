# Telemetry

This extension sends usage data to Microsoft to help us understand which features are
used and where they fail, so we can improve them. This page describes exactly what is
and is not sent. Telemetry respects your VS Code telemetry setting — if you have
already turned telemetry off in VS Code, this extension sends nothing.

## What we collect

**Which features you use**

* Which extension commands you run.
* Which screen you opened and which action you took in it — for example, that you
  opened the Create Cluster screen and started a cluster creation. What you typed into
  the form is not included.
* Whether creating a cluster succeeded.

**How the GitHub Copilot for Azure (`@azure`) integration went**

When you ask `@azure` to do something that involves AKS, we record how far the
conversation got, so we can find where it breaks down:

* Which extension feature the request used.
* Whether you selected a subscription, a cluster, and a manifest file.
* Which of the cluster choices you picked.
* Whether you cancelled the deployment.
* Whether the deployment succeeded, and whether you clicked the link shown afterwards.

## What we do not collect

We do not collect anything that identifies your code or your Azure resources. That
includes:

* Cluster, resource group, subscription and registry names.
* File paths, image names and container registry contents.
* Anything you type into a form in the extension.
* The contents of your manifests, Dockerfiles or source code.

Container Assist does send your source code and project details to a language model in
order to generate deployment files for you. That is a different thing from the usage
data described here, and it is covered separately in
[AI Data Flow and Privacy](./features/container-assist-ai-data-flow.md).

## Turning it off

Set `telemetry.telemetryLevel` to `off` in your VS Code settings. This turns off
telemetry for VS Code and every extension, including this one. If you have used the
older `telemetry.enableTelemetry` setting, note that VS Code replaced it in version
1.61.

See the
[VS Code telemetry FAQ](https://code.visualstudio.com/docs/supporting/faq#_how-to-disable-telemetry-reporting)
for details, and the
[Microsoft privacy statement](https://privacy.microsoft.com/privacystatement) for how
Microsoft handles the data.
