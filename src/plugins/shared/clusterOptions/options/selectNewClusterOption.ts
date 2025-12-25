import { commands } from "vscode";
import { Errorable } from "../../../../commands/utils/errorable";

export async function selectNewClusterOption(): Promise<Errorable<boolean>> {
    await commands.executeCommand("aks.aksCreateClusterFromCopilot");
    return { succeeded: true, result: true };
}
