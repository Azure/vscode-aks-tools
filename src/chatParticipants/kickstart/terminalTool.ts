import * as vscode from "vscode";
import { Errorable } from "../../commands/utils/errorable";

// The real tool name as registered by the Copilot extension.
const RUN_IN_TERMINAL_TOOL = "run_in_terminal";

export async function runInTerminal(
    command: string,
    cwd: string,
    token: vscode.CancellationToken,
    toolInvocationToken?: vscode.ChatParticipantToolToken,
): Promise<Errorable<string>> {
    const toolAvailable = vscode.lm.tools.some((t) => t.name === RUN_IN_TERMINAL_TOOL);
    if (!toolAvailable) {
        return {
            succeeded: false,
            error: "The built-in `run_in_terminal` tool is not available. Please use Kickstart in agent mode with GitHub Copilot Chat.",
        };
    }

    // The tool does not accept a cwd parameter — prepend a cd to the command instead.
    const fullCommand = `cd ${JSON.stringify(cwd)} && ${command}`;

    try {
        const result = await vscode.lm.invokeTool(
            RUN_IN_TERMINAL_TOOL,
            {
                input: {
                    command: fullCommand,
                    explanation: `Running: ${command}`,
                    goal: command,
                    mode: "sync",
                },
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
