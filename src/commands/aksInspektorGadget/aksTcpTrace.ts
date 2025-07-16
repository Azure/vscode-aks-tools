import { IActionContext } from "@microsoft/vscode-azext-utils";
import { openInspektorGadget } from "./inspektorGadgetHelper";

export async function aksRealTimeTcpMonitoring(context: IActionContext, target: unknown): Promise<void> {
    await openInspektorGadget(context, target, {
        title: "launching Inspektor Gadget tool for Real-Time TCP Monitoring",
        category: "trace",
        resource: "tcp",
    });
}
