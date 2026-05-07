import * as vscode from "vscode";
import { Errorable } from "../../commands/utils/errorable";

export async function runInTerminal(
    command: string,
    cwd: string,
    token: vscode.CancellationToken,
    toolInvocationToken?: vscode.ChatParticipantToolToken,
): Promise<Errorable<string>> {
    try {
        const result = await vscode.lm.invokeTool(
            "runInTerminal",
            {
                input: { command, cwd },
                toolInvocationToken,
            },
            token,
        );

        let output = "";
        for (const part of result.content) {
            if (part instanceof vscode.LanguageModelTextPart) {
                output += part.value;
            }
        }

        return { succeeded: true, result: output };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { succeeded: false, error: `Terminal command failed: ${message}` };
    }
}
