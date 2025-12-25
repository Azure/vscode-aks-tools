import { IActionContext } from "@microsoft/vscode-azext-utils";
import { GadgetCategory, GadgetResource, openInspektorGadget } from "./inspektorGadgetHelper";

export async function aksRealTimeTcpMonitoring(context: IActionContext, target: unknown): Promise<void> {
    await openInspektorGadget(context, target, {
        title: "launching Inspektor Gadget tool for Real-Time TCP Monitoring",
        category: GadgetCategory.Trace,
        resource: GadgetResource.Tcp,
    });
}
