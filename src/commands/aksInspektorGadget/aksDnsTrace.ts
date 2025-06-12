import { IActionContext } from "@microsoft/vscode-azext-utils";
import { openInspektorGadgetTrace } from "./inspektorGadgetHelper";

export async function aksDnsDebug(context: IActionContext, target: unknown): Promise<void> {
    await openInspektorGadgetTrace(context, target, {
        title: "Launching Inspektor Gadget DNS Debug Tool",
        resource: "dns",
    });
}
