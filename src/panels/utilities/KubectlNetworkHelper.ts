import { platform } from "os";
import { Uri, workspace } from "vscode";
import { relative } from "path";
import { invokeKubectlCommand } from "../../commands/utils/kubectl";
import { Errorable, map as errmap } from "../../commands/utils/errorable";
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
    const command = `get node -l kubernetes.io/os=linux --no-headers -o custom-columns=":metadata.name"`;
    const commandResult = await invokeKubectlCommand(kubectl, kubeConfigFile, command);
    return errmap(commandResult, (sr) => sr.stdout.trim().split("\n"));
}
