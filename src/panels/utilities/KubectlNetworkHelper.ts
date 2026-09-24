import { platform } from "os";
import { Uri, workspace } from "vscode";
import { relative } from "path";
import { invokeKubectlCommandArgs } from "../../commands/utils/kubectl";
import { Errorable, map as errmap, bind } from "../../commands/utils/errorable";
import { validateK8sNames } from "../../commands/utils/kubernetesNames";
import * as k8s from "vscode-kubernetes-tools-api";

export function getLocalKubectlCpPath(fileUri: Uri): string {
    if (platform().toLowerCase() !== "win32") {
        return fileUri.fsPath;
    }

    // Use a relative path to work around Windows path issues:
    // - https://github.com/kubernetes/kubernetes/issues/77310
    // - https://github.com/kubernetes/kubernetes/issues/110120
    // To use a relative path we need to know the current working directory.
    // This should be `process.cwd()` but it actually seems to be that of the first workspace folder, if any exist.
    // TODO: Investigate why, and look at alternative ways of getting the working directory, or working around
    //       the need to to this altogether by allowing absolute paths.
    const workingDirectory =
        workspace.workspaceFolders && workspace.workspaceFolders?.length > 0
            ? workspace.workspaceFolders[0].uri.fsPath
            : process.cwd();

    return relative(workingDirectory, fileUri.fsPath);
}

export async function getLinuxNodes(
    kubectl: k8s.APIAvailable<k8s.KubectlV1>,
    kubeConfigFile: string,
): Promise<Errorable<string[]>> {
    const args = ["get", "node", "-l", "kubernetes.io/os=linux", "--no-headers", "-o", "custom-columns=:metadata.name"];
    const commandResult = await invokeKubectlCommandArgs(kubectl, kubeConfigFile, args);
    const lines = errmap(commandResult, (sr) => sr.stdout.trim().split("\n"));
    return bind(lines, (names) => validateK8sNames(names, "subdomain", "node"));
}
