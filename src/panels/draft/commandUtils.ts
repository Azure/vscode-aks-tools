import { commands } from "vscode";
import { DraftCommandName, DraftCommandParamsType } from "../../commands/draft/types";

export function launchDraftCommand<TCommand extends DraftCommandName>(
    command: TCommand,
    params: DraftCommandParamsType<TCommand>,
): void {
    commands.executeCommand(command, params);
}
