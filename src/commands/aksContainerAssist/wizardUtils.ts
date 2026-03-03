import * as vscode from "vscode";
import * as l10n from "@vscode/l10n";

/**
 * Common function to handle wizard exit confirmation with "Go Back" option.
 * Shows a modal dialog asking if user wants to exit the Container Assist wizard.
 * If user chooses "Go Back", calls the provided retry function.
 * If user chooses "Exit" or closes dialog, returns undefined.
 */
export async function showWizardExitConfirmation<T>(retryFunction: () => Promise<T>): Promise<T | undefined> {
    const continueWizard = l10n.t("Exit Container Assist");
    const goBack = l10n.t("Go Back");
    const choice = await vscode.window.showWarningMessage(
        l10n.t("Are you sure you want to exit the Container Assist wizard?"),
        { modal: true },
        goBack,
        continueWizard,
    );

    if (choice === goBack) {
        return retryFunction();
    }
    // If they chose "Exit Container Assist" or closed the dialog, return undefined
    return undefined;
}
