import { IActionContext } from "@microsoft/vscode-azext-utils";
import { openInspektorGadget } from "./inspektorGadgetHelper";

export async function aksProfileCpu(context: IActionContext, target: unknown): Promise<void> {
    await openInspektorGadget(context, target, {
        title: "launching Inspektor Gadget tool for CPU Profiling",
        category: "profile",
        resource: "cpu",
    });
}
