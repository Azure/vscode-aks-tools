import { IActionContext } from "@microsoft/vscode-azext-utils";
import { openInspektorGadgetTrace } from "./inspektorGadgetHelper";

export async function aksInvestigateDns(context: IActionContext, target: unknown): Promise<void> {
    await openInspektorGadgetTrace(context, target, {
        title: "Launching Inspektor Gadget Tool for DNS Investigation",
        resource: "dns",
    });
}
