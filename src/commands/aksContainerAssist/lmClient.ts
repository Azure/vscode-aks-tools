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

    async sendRequestWithTools(
        systemPrompt: string,
        userPrompt: string,
        options: {
            tools: vscode.LanguageModelChatTool[];
            toolHandler: (call: vscode.LanguageModelToolCallPart) => Promise<string>;
            maxToolRounds?: number;
        },
        token?: vscode.CancellationToken,
    ): Promise<Errorable<string>> {
        if (!this.languageModel) {
            return {
                succeeded: false,
                error: l10n.t("Language Model not available"),
            };
        }

        const maxRounds = options.maxToolRounds ?? 5;

        try {
            const messages: vscode.LanguageModelChatMessage[] = [
                vscode.LanguageModelChatMessage.User(systemPrompt),
                vscode.LanguageModelChatMessage.User(userPrompt),
            ];

            logger.debug("Sending request with tools to Language Model", {
                model: this.languageModel.name,
                tools: options.tools.map((t) => t.name),
                maxRounds,
            });

            for (let round = 0; round < maxRounds; round++) {
                const response = await this.languageModel.sendRequest(messages, { tools: options.tools }, token);

                const textParts: vscode.LanguageModelTextPart[] = [];
                const toolCallParts: vscode.LanguageModelToolCallPart[] = [];

                for await (const part of response.stream) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        textParts.push(part);
                    } else if (part instanceof vscode.LanguageModelToolCallPart) {
                        toolCallParts.push(part);
                    }
                }

                // If no tool calls, we're done — return accumulated text
                if (toolCallParts.length === 0) {
                    const content = textParts.map((p) => p.value).join("");
                    logger.debug("Tool calling complete", { round: round + 1, contentLength: content.length });
                    return { succeeded: true, result: content };
                }

                // Build assistant message echoing back text and tool call parts
                const assistantParts: (vscode.LanguageModelTextPart | vscode.LanguageModelToolCallPart)[] = [
                    ...textParts,
                    ...toolCallParts,
                ];
                messages.push(vscode.LanguageModelChatMessage.Assistant(assistantParts));

                // Execute tool handlers and build result parts
                const resultParts: vscode.LanguageModelToolResultPart[] = [];
                for (const toolCall of toolCallParts) {
                    const resultText = await options.toolHandler(toolCall);
                    resultParts.push(
                        new vscode.LanguageModelToolResultPart(toolCall.callId, [
                            new vscode.LanguageModelTextPart(resultText),
                        ]),
                    );
                }

                // Append user message with tool results
                messages.push(vscode.LanguageModelChatMessage.User(resultParts));
            }

            // Max rounds exhausted — return error
            logger.warn("Max tool rounds exhausted");
            return {
                succeeded: false,
                error: l10n.t("Language Model tool calling exceeded maximum rounds ({0})", maxRounds),
            };
        } catch (error) {
            logger.error("Language Model request with tools failed", error);
            return this.handleError(error);
        }
    }

    async selectModel(showPicker: boolean = false): Promise<Errorable<vscode.LanguageModelChat>> {
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

            const preferences = this.getModelPreferences();
            const preferredModels = allModels.filter((m) => this.isPreferredModel(m, preferences));

            let selectedModel: vscode.LanguageModelChat | undefined;

            if (showPicker) {
                selectedModel = await this.showModelSelectionQuickPick(allModels, preferences);
            } else {
                selectedModel = preferredModels[0] ?? allModels[0];
                if (selectedModel !== preferredModels[0] && preferredModels.length === 0) {
                    logger.warn(
                        `Preferred model (${preferences.vendor}/${preferences.family}) not found, using first available`,
                    );
                }
            }

            if (!selectedModel) {
                return { succeeded: false, error: l10n.t("Model selection cancelled") };
            }

            this.languageModel = selectedModel;
            logger.info(`Language Model selected: ${this.languageModel.name} (${this.languageModel.id})`);
            return { succeeded: true, result: this.languageModel };
        } catch (error) {
            logger.error("Failed to check Language Model availability", error);
            return this.handleError(error);
        }
    }

    private getModelPreferences() {
        const config = vscode.workspace.getConfiguration("aks.containerAssist");
        return {
            family: config.get<string>("modelFamily", DEFAULT_LM_MODEL_FAMILY),
            vendor: config.get<string>("modelVendor", DEFAULT_LM_MODEL_VENDOR),
        };
    }

    private isPreferredModel(
        model: vscode.LanguageModelChat,
        preferences: { family: string; vendor: string },
    ): boolean {
        return model.family === preferences.family && model.vendor === preferences.vendor;
    }

    private async showModelSelectionQuickPick(
        models: vscode.LanguageModelChat[],
        preferences: { family: string; vendor: string },
    ): Promise<vscode.LanguageModelChat | undefined> {
        const items: ModelQuickPickItem[] = models
            .map((model) => {
                const isPreferred = this.isPreferredModel(model, preferences);
                return {
                    label: isPreferred ? `$(star-full) ${model.name}` : model.name,
                    description: `${model.vendor} / ${model.family}`,
                    detail: isPreferred ? l10n.t("Configured as preferred model") : model.id,
                    model,
                    isPreferred,
                };
            })
            .sort((a, b) => {
                if (a.isPreferred !== b.isPreferred) return a.isPreferred ? -1 : 1;
                return a.label.localeCompare(b.label);
            });

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
