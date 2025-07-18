import { IActionContext } from "@microsoft/vscode-azext-utils";
import { GadgetCategory, GadgetResource, openInspektorGadget } from "./inspektorGadgetHelper";

export async function aksInvestigateDns(context: IActionContext, target: unknown): Promise<void> {
    await openInspektorGadget(context, target, {
        title: "launching Inspektor Gadget tool for DNS Investigation",
        category: GadgetCategory.Trace,
        resource: GadgetResource.Dns,
    });
}
