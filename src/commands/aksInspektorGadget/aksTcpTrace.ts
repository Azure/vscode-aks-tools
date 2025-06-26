import { IActionContext } from "@microsoft/vscode-azext-utils";
import { openInspektorGadgetTrace } from "./inspektorGadgetHelper";

export async function aksRealTimeTcpMonitoring(context: IActionContext, target: unknown): Promise<void> {
    await openInspektorGadgetTrace(context, target, {
        title: "Launching Inspektor Gadget Tool for Real-Time TCP Monitoring",
        resource: "tcp",
    });
}
