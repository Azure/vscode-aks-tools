import { IActionContext } from "@microsoft/vscode-azext-utils";
import { openInspektorGadget } from "./inspektorGadgetHelper";

export async function aksTopFile(context: IActionContext, target: unknown): Promise<void> {
    await openInspektorGadget(context, target, {
        title: "launching Inspektor Gadget tool for identifying files being read and written to",
        category: "top",
        resource: "file",
    });
}
