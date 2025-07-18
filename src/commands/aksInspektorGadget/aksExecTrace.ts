import { IActionContext } from "@microsoft/vscode-azext-utils";
import { GadgetCategory, GadgetResource, openInspektorGadget } from "./inspektorGadgetHelper";

export async function aksTraceExec(context: IActionContext, target: unknown): Promise<void> {
    await openInspektorGadget(context, target, {
        title: "launching Inspektor Gadget tool for viewing processes executing in kernel",
        category: GadgetCategory.Trace,
        resource: GadgetResource.Exec,
    });
}
