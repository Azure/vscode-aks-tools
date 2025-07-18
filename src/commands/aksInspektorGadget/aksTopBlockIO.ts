import { IActionContext } from "@microsoft/vscode-azext-utils";
import { GadgetCategory, GadgetResource, openInspektorGadget } from "./inspektorGadgetHelper";

export async function aksTopBlockIO(context: IActionContext, target: unknown): Promise<void> {
    await openInspektorGadget(context, target, {
        title: "launching Inspektor Gadget tool for identifying Block I/O intensive processes",
        category: GadgetCategory.Top,
        resource: GadgetResource.BlockIO,
    });
}
