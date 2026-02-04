import * as vscode from "vscode";
import { Errorable } from "../utils/errorable";
import { ModelQuickPickItem } from "./types";
import { logger } from "./logger";
import * as l10n from "@vscode/l10n";

export const DEFAULT_LM_MODEL_FAMILY = "gpt-4o";
export const DEFAULT_LM_MODEL_VENDOR = "copilot";

export class LMClient {
    private languageModel: vscode.LanguageModelChat | undefined;

    getModel(): vscode.LanguageModelChat | undefined {
        return this.languageModel;
    }

    hasModel(): boolean {
        return this.languageModel !== undefined;
    }

    async ensureModel(): Promise<Errorable<vscode.LanguageModelChat>> {
        if (this.languageModel) {
            return { succeeded: true, result: this.languageModel };
        }
        return this.selectModel(false);
    }

    async sendRequest(
        systemPrompt: string,
        userPrompt: string,
        token?: vscode.CancellationToken,
    ): Promise<Errorable<string>> {
        if (!this.languageModel) {
            return {
                succeeded: false,
                error: l10n.t("Language Model not available"),
            };
        }

        try {
            const messages = [
                vscode.LanguageModelChatMessage.User(systemPrompt),
                vscode.LanguageModelChatMessage.User(userPrompt),
            ];

            logger.debug("Sending request to Language Model", { model: this.languageModel.name });
            const response = await this.languageModel.sendRequest(messages, {}, token);

            let content = "";
            for await (const chunk of response.text) {
                content += chunk;
            }

            logger.debug("Language Model response received", { contentLength: content.length });
            return { succeeded: true, result: content };
        } catch (error) {
            logger.error("Language Model request failed", error);
            return this.handleError(error);
        }
    }

    async selectModel(allowSelection: boolean = false): Promise<Errorable<vscode.LanguageModelChat>> {
        try {
            logger.info("Checking Language Model availability...");

            const allModels = await vscode.lm.selectChatModels({});

            if (!allModels || allModels.length === 0) {
                const errorMsg = l10n.t(
                    "No Language Model available. Please ensure GitHub Copilot is installed and signed in.",
                );
                logger.error("No Language Models found");
                return { succeeded: false, error: errorMsg };
            }

            logger.debug(`Found ${allModels.length} available models`);

            if (allowSelection && allModels.length > 1) {
                const selectedModel = await this.showModelSelectionQuickPick(allModels);
                if (!selectedModel) {
                    return { succeeded: false, error: l10n.t("Model selection cancelled") };
                }
                this.languageModel = selectedModel;
            } else {
                const config = vscode.workspace.getConfiguration("aks.containerAssist");
                const preferredFamily = config.get<string>("modelFamily", DEFAULT_LM_MODEL_FAMILY);
                const preferredVendor = config.get<string>("modelVendor", DEFAULT_LM_MODEL_VENDOR);

                const preferredModels = await vscode.lm.selectChatModels({
                    vendor: preferredVendor,
                    family: preferredFamily,
                });

                if (preferredModels && preferredModels.length > 0) {
                    this.languageModel = preferredModels[0];
                } else {
                    logger.warn(`Preferred model (${preferredVendor}/${preferredFamily}) not found, using first available`);
                    this.languageModel = allModels[0];
                }
            }

            logger.info(`Language Model selected: ${this.languageModel.name} (${this.languageModel.id})`);
            return { succeeded: true, result: this.languageModel };
        } catch (error) {
            logger.error("Failed to check Language Model availability", error);
            return this.handleError(error);
        }
    }

    private async showModelSelectionQuickPick(models: vscode.LanguageModelChat[]): Promise<vscode.LanguageModelChat | undefined> {
        const items: ModelQuickPickItem[] = models.map((model) => ({
            label: model.name,
            description: `${model.vendor} / ${model.family}`,
            detail: model.id,
            model,
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: l10n.t("Select a Language Model for generating deployment files"),
            title: l10n.t("Container Assist - Model Selection"),
        });

        return selected?.model;
    }

    private handleError(error: unknown): Errorable<never> {
        if (error instanceof vscode.LanguageModelError) {
            return {
                succeeded: false,
                error: l10n.t("Language Model error: {0} (code: {1})", error.message, error.code),
            };
        }
        return {
            succeeded: false,
            error: l10n.t("Language Model request failed: {0}", String(error)),
        };
    }
}
