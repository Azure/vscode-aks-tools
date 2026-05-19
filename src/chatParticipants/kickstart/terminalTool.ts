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

        const failure = detectFailure(output);
        if (failure) {
            return { succeeded: false, error: `${failure}\n\nOutput:\n${output}` };
        }

        return { succeeded: true, result: output };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { succeeded: false, error: `Terminal command failed: ${message}` };
    }
}

/**
 * Inspects terminal output for indicators of command failure.
 *
 * The `run_in_terminal` tool resolves successfully whenever the command runs to
 * completion — it does NOT reject on a non-zero exit code. We must therefore
 * scrape the captured output for failure markers ourselves, otherwise callers
 * (e.g. the build phase) will report failed `az acr build` runs as successful.
 *
 * Returns a short error description when failure is detected, or `undefined`
 * when the output looks clean.
 */
function detectFailure(output: string): string | undefined {
    if (!output) {
        return undefined;
    }

    // VS Code's run_in_terminal tool typically appends a line like
    // "Command exited with code 1" or "exit code: 1" for non-zero exits.
    const exitCodeMatch = output.match(/exit(?:ed with)?\s*code[:\s]+(-?\d+)/i);
    if (exitCodeMatch && exitCodeMatch[1] !== "0") {
        return `Command exited with non-zero code ${exitCodeMatch[1]}.`;
    }

    // `az acr build` summary lines on failure. Match either the per-run summary
    // ("Run ID: xxx failed") or a standalone "Run failed" line.
    if (/(?:Run ID:\s*\S+\s+(?:failed|was unsuccessful))|(?:^\s*Run failed\b)/im.test(output)) {
        return "ACR build run reported failure.";
    }

    // Generic Azure CLI / docker error markers (must appear at start of a line
    // to avoid matching benign mentions inside informational text).
    if (/^\s*ERROR:\s/m.test(output)) {
        return "Command emitted an ERROR: message.";
    }

    // kubectl failure markers. kubectl returns non-zero on these but VS Code's
    // run_in_terminal does not always surface the exit code in captured output.
    //   - "error: ..." / "error validating ..." (the former subsumes the latter)
    //   - "Error from server (...): ..."
    //   - "Unable to connect to the server: ..."
    //   - "The connection to the server ... was refused"
    if (
        /^\s*error[:\s]/im.test(output) ||
        /^\s*Error from server\b/m.test(output) ||
        /^\s*Unable to connect to the server\b/m.test(output) ||
        /^\s*The connection to the server\b.*\bwas refused\b/m.test(output)
    ) {
        return "kubectl reported an error.";
    }

    return undefined;
}
