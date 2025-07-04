import { window } from "vscode";
import { getReadySessionProvider } from "../../auth/azureAuth";
import { failed } from "../utils/errorable";
import { getSubscriptions, handleNoSubscriptionsFound, SelectionType } from "../utils/subscriptions";
import { getClusterList } from "../utils/clusterfilter";
// import { ContainerServiceClient } from "@azure/arm-containerservice";
// import { getCredential } from "../../auth/azureAuth";
import { join } from "path";
import { tmpdir } from "os";
import * as k8s from "vscode-kubernetes-tools-api";
import { unlinkSync, writeFileSync } from "fs";
import { deployModel } from "../../panels/utilities/KaitoHelpers";
import * as vscode from "vscode";
import { getKubeconfigYaml } from "../utils/clusters";

export async function aksKaitoDeployCRD() {
    const doc = window.activeTextEditor?.document;
    if (!doc) {
        window.showErrorMessage("Open a CRD YAML to deploy");
        return;
    }

    // prerequisites
    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        window.showWarningMessage("Kubectl is unavailable.");
        return;
    }

    const sessionProvider = await getReadySessionProvider();
    if (failed(sessionProvider)) {
        window.showErrorMessage(sessionProvider.error);
        return;
    }

    const allSubscriptions = await getSubscriptions(sessionProvider.result, SelectionType.All);
    if (failed(allSubscriptions)) {
        window.showErrorMessage(allSubscriptions.error);
        return;
    }

    if (allSubscriptions.result.length === 0) {
        handleNoSubscriptionsFound();
        return;
    }

    // subscriptions quick pick
    const quickPickSubscriptions = allSubscriptions.result.map((sub) => ({
        label: sub.displayName || "",
        description: sub.subscriptionId,
    }));

    const pickedSub = await window.showQuickPick(quickPickSubscriptions, {
        placeHolder: "Select a subscription",
        canPickMany: false,
    });

    if (!pickedSub) {
        return;
    }
    console.log(pickedSub);

    const clusterList = await getClusterList(pickedSub.label, pickedSub.description, sessionProvider.result);
    if (failed(clusterList)) {
        window.showErrorMessage(clusterList.error);
        return;
    }
    console.log(clusterList);

    if (clusterList.result.length === 0) {
        window.showInformationMessage("No AKS clusters found in the selected subscription.");
        return;
    }

    // clusters quick pick
    const cluster = await window.showQuickPick(
        clusterList.result.map((c) => ({
            label: c.name,
            description: c.resourceGroup,
            payload: c,
        })),
        {
            placeHolder: `Select a cluster in ${pickedSub.label}`,
        },
    );
    if (!cluster) {
        return;
    }

    ///////////////////////////////////////////
    // await window.showInformationMessage(`CRD deployed to ${cluster.label}.`, "View KAITO Deployments");
    const getKubeconfig = await getKubeconfigYaml(
        sessionProvider.result,
        pickedSub.description!,
        cluster.description!,
        cluster.payload,
    );

    if (failed(getKubeconfig)) {
        window.showErrorMessage(getKubeconfig.error);
        return;
    }
    ///////////////////////////////////////////

    // console.log("water");
    // console.log(water.result);

    // console.log(cluster.payload);
    // // Get the kubeconfig for the selected cluster
    // const creds = await new ContainerServiceClient(
    //     getCredential(sessionProvider.result),
    //     pickedSub.description!,
    // ).managedClusters.listClusterAdminCredentials(cluster.description!, cluster.label);

    // // converting raw to string
    // const raw = creds.kubeconfigs![0].value!;
    // const rawString = Buffer.from(raw).toString("utf8");
    // console.log(rawString);

    // const pick = await window.showInformationMessage(
    //     `test CRD Deployed to ${cluster.label}.`,
    //     "View KAITO Deployments",
    // );
    // if (pick === "View KAITO Deployments") {
    //     window.showInformationMessage("Opening Kaito management panel...");
    //     vscode.commands.executeCommand("aks.aksKaitoManage", { target: "ha", clusterInfo: "ha", yaml: "ha" });
    // }

    const kubePath = join(tmpdir(), `aks-${cluster.label}-${Date.now()}.config`);
    writeFileSync(kubePath, getKubeconfig.result, "utf8");

    // deploying with kubeconfig temp file, wrapped in try-finally to ensure cleanup
    try {
        const result = await deployModel(doc.getText(), kubectl, kubePath);
        if (result.succeeded) {
            const pick = await window.showInformationMessage(
                `CRD Deployed to ${cluster.label}.`,
                "View KAITO Deployments",
            );
            if (pick === "View KAITO Deployments") {
                vscode.commands.executeCommand("aks.aksKaitoManage", {
                    name: cluster.label,
                    subscriptionId: pickedSub.description!,
                    resourceGroupName: cluster.description!,
                    yaml: getKubeconfig.result,
                });
            }
        } else {
            window.showErrorMessage(`CRD Deployment failed: ${result.error}`);
        }
    } finally {
        unlinkSync(kubePath); // Clean up the kubeconfig file
    }
}
