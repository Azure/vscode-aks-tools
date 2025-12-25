/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ResourceGraphModels } from "@azure/arm-resourcegraph";
import { type AzureSubscriptionProvider } from "@microsoft/vscode-azext-azureauth";
import type * as vscode from "vscode";
import { type z } from "zod";
import { type LocalPluginManifest } from "./AiDriver";

export type AgentId = "ms-azuretools.azure-agent";

export type AgentName = "azure";

/**
 * Information that should be available on the package.json of an extension which is compabitible with the @azure extension.
 * This information should be placed in an `agentMetdata` property.
 */
export type ExtensionAgentMetadata = {
    version: "2.0";

    /**
     * Identifier of the command to get contributed plugins. This command must return a {@link GetPluginsCommandResult}.
     */
    getPluginsCommand: string;
};

/**
 * Any JSON serializable object. If the function being invoked in the plugin declared it will handle the user response, then this result
 * will be ignored.
 */
export type ResponseForLanguageModel = object | boolean | number | string;

/**
 * @experimental This type is experimental and likely to change.
 */
export type ResponseForLanguageModelExtended = {
    /**
     * The result of the local plugin function, will be returned to the orchestration platform.
     */
    responseForLanguageModel: object;

    /**
     * Any follow-up prompts a plugin thinks should be displayed to the user. These are not guaranteed to be used. For example, there may
     * be a limit on how many follow-ups will be displayed.
     */
    followUps?: vscode.ChatFollowup[];

    /**
     * Any additional chat response parts (ex: buttons) to be displayed after the LLMs response, after the LLM has finished responding. Each part is displayed
     * in the order they are in the array. These are not guaranteed to be used. For example, only additional chat response parts from the last invoked
     * plugin may be displayed.
     */
    chatResponseParts?: vscode.ChatResponsePart[];
};

export type LocalPluginResult = ResponseForLanguageModel | ResponseForLanguageModelExtended;

/**
 * A request to a local plugin to invoke a specific function.
 */
export type LocalPluginRequest<FunctionNameT = string, ParamsT = { [key: string]: unknown }> = {
    readonly functionName: FunctionNameT;
    readonly parameters: ParamsT;
};

export type LocalPluginArgs<FunctionNameT = string, ParamsT = { [key: string]: unknown }> = {
    agentRequest: AgentRequest;
    localPluginRequest: LocalPluginRequest<FunctionNameT, ParamsT>;
    pluginHelpers: PluginHelpers;
};

/**
 * Something that can handler a specific local plugin ({@link LocalPluginEntry}).
 */
export interface ILocalPluginHandler {
    execute(args: LocalPluginArgs): Promise<LocalPluginResult>;
}

/**
 * The name, maninfest, and handler, for a local plugin.
 */
export type LocalPluginEntry = {
    manifest: LocalPluginManifest;
    handler: ILocalPluginHandler;
};

/**
 * The result expected from a {@link ExtensionAgentMetadata.getPluginsCommand} command.
 */
export type GetPluginsCommandResult = {
    plugins: LocalPluginEntry[];
};

/**
 * An object which contains information regarding the request the agent received from VS Code to handle a user prompt.
 *
 * This type is commonly passed to other objects to do something based on the {@link AgentRequest.userPrompt} and {@link AgentRequest.context}. For example, {@link IAzureResourceGraphHelper.queryAzureResourceGraph} will
 * query Azure Resource Graph, with a prompt generated based on {@link AgentRequest.userPrompt}. If however you want to do something with these other objects based on a different prompt or context, you can simply create a
 * new {@link AgentRequest} object based on the one passed to you, but with the new prompt or context.
 *
 * @example
 *
 * ```
 * async function doSomethingWithDifferentPrompt(request: AgentRequest, azureResourceGraphHelper: IAzureResourceGraphHelper): QueryAzureResourceGraphResult {
 *     // Query Azure Resource Graph with a prmopt different from the one in the original request.
 *     // I know from `IAzureResourceGraphHelper.queryAzureResourceGraph`'s documentation that it doesn't makes use of the request's context, so I won't worry about overwriting it.
 *     // However, if it did, I would need to decide if I want to keep the original context or overwrite it.
 *     const requestWithDifferentPrompt = {
 *         ...request,
 *         userPrompt: "A different prompt",
 *     };
 *     return await azureResourceGraphHelper.queryAzureResourceGraph(requestWithDifferentPrompt);
 * }
 * ```
 */
export type AgentRequest = {
    command?: string;

    /**
     * The user prompt that the agent should respond to.
     */
    userPrompt: string;

    responseStream: vscode.ChatResponseStream;
    context: vscode.ChatContext;
    requestId: string;

    /**
     * A token that indicates if the user has cancelled the request.
     *
     * If a skill (aka, things receiving an {@link AgentRequest} via a {@link SkillCommandArgs}) is handling a request and notices cancellation, the skill should stop
     * processing the request and return a {@link SkillCommandResult}. Attempts to use `invokeOther` will be ignored. Information in {@link SkillCommandResult.chatAgentResult.metadata.telemetryProperties}
     * will still be sent to telemetry. There are no other guarantees about what will happen with other data in the result.
     */
    token: vscode.CancellationToken;
};

export type LanguageModelInteractionOptions = {
    /**
     * What type of history (aka, users requests prior to the current one) to include in the context for the language model interaction.
     * - `"none"`: No history will be included (default)
     * - `"all"`: All history will be included
     */
    includeHistory?: "none" | "all";

    /**
     * Whether or not to cache the result of the language model interaction. Default is `false`.
     *
     * This option is `false` by default as to make sure setting the cache is an intentional choice by the developer. Caching the result of a language model
     * interaction has the potential to cause a negative user experience. For example, the user may not be happy with the answer to a question and is quickly
     * retrying it. If the line of code that invokes the language model to produce that answer has `setCache` set to true, then the user will simply get the
     * same answer.
     *
     * Alternatively, if there's an interaction which is repeated many times, by the agent itself, in a short period of time; or if there is low risk to
     * the result of the interaction being "wrong", then setting `setCache` to `true` could be beneficial.
     */
    setCache?: boolean;

    /**
     * Whether or not to use the cached result of a previous language model interaction that matches this one. Default is `true`.
     *
     * Unlike {@link LanguageModelInteractionOptions.setCache}, this option is `true` by default as if an interaction does set the cache, there shouldn't be any
     * additional action requried by the developer to also use the cache.
     */
    useCache?: boolean;

    /**
     * A progress message to display to the user while waiting for a response from language model.
     *
     * Should not be used if this interaction is being done in parallel with other interactions.
     */
    progressMessage?: string;

    /**
     * A chat language model that should be used instead of the preferred language model
     */
    languageModelChat?: vscode.LanguageModelChat;

    /**
     * Whether to suppress errors that occur during the language model interaction. Default is `false`.
     */
    suppressError?: boolean;
};

export type LanguageModelInteractionResult =
    | { languageModelResponded: true; languageModelResponse: string }
    | { languageModelResponded: false; languageModelResponse: undefined };

/**
 * Helps with using the VS Code language model API.
 */
export interface ILanguageModelHelper {
    /**
     * Gets the maximum number of tokens that can be used in a single language model interaction. The limit is based on what lanuage models are currently available from VS Code's language model's.
     */
    getLanguageModelTokenLimit(): Promise<number>;

    /**
     * Starts an interaction with the VS Code language model API, where the output from the language model is outputted verbatim to the user.
     */
    verbatimLanguageModelInteraction(
        primaryPrompt: string,
        request: AgentRequest,
        options?: LanguageModelInteractionOptions,
    ): Promise<LanguageModelInteractionResult>;

    /**
     * Starts an interaction with the VS Code language model API, where the output from the language model is returned as a `string`.
     */
    getResponseAsStringLanguageModelInteraction(
        primaryPrompt: string,
        request: AgentRequest,
        options?: LanguageModelInteractionOptions,
    ): Promise<string | undefined>;
}

export type QueryAzureResourceGraphResult = {
    /**
     * The query that was used to query Azure Resource Graph.
     */
    query: string;
    /**
     * The response from the query to Azure Resource Graph.
     */
    response: ResourceGraphModels.QueryResponse;
};

/**
 * Helps with querying Azure Resource Graph.
 */
export interface IAzureResourceGraphHelper {
    /**
     * Queries Azure Resource Graph based on {@param request}'s user prompt.
     */
    queryAzureResourceGraph(request: AgentRequest): Promise<QueryAzureResourceGraphResult | undefined>;
}

export type TypeChatTranslationOptions = {
    /**
     * What type of history (aka, users requests prior to the current one) to include in the context for the TypeChat translation.
     * - `"none"`: No history will be included (default)
     * - `"all"`: All history will be included
     */
    includeHistory?: "none" | "all";
};

/**
 * Helps with using TypeChat.
 */
export interface ITypeChatHelper {
    /**
     * Translates the {@param request}'s user prompt into an object whose type matches the given {@param zodSchema}.
     */
    getTypeChatTranslation<TZodSchema extends Record<string, z.ZodType>, TTypeName extends keyof TZodSchema & string>(
        zodSchema: TZodSchema,
        typeName: TTypeName,
        request: AgentRequest,
        options?: TypeChatTranslationOptions,
    ): Promise<z.TypeOf<TZodSchema[TTypeName]> | undefined>;
}

export type AzureResourceConnection<TypeT = string, KindT = string | undefined> = {
    type: TypeT;
    kind?: KindT;
    name: string;
    subscriptionId: string;
    resourceGroup: string;
};

/**
 * Helps with understanding and using the conversation history.
 */
export interface IConversationHelper {
    /**
     * Takes the conversation history (including the current user prompt) from {@param request} and returns it as a `string` which represents a conversation between a user and an assistant.
     */
    getConversationAsString(request: AgentRequest): Promise<string>;

    /**
     * Gets the conversation's current resource context, if one has been established.
     */
    getResourceContext(request: AgentRequest): AzureResourceConnection | undefined;
}

/**
 * A collection of objects to help with the handling of a user prompt.
 */
export type PluginHelpers = {
    /**
     * Use this helper to query Azure Resource Graph.
     */
    azureResourceGraphHelper: IAzureResourceGraphHelper;

    /**
     * Use this helper to understand and use the conversation history.
     */
    conversationHelper: IConversationHelper;

    /**
     * Use this helper to interact with the VS Code language model API.
     *
     * Doing so centralizes the logic for interacting with the language model (ex: choosing a model, rate limiting, etc.), and avoids the user having to authorize a different extension to access the VS Code language model API.
     */
    languageModelHelper: ILanguageModelHelper;

    /**
     * Use this output channel to log on behalf of the Azure agent.
     *
     * Doing so centralizes the logs for the user, making it easier for them to find information about what the Azure agent is doing.
     */
    outputChannel: vscode.OutputChannel;

    /**
     * Use this subscription provider to get information about Azure subscriptions on behalf of the Azure agent.
     *
     * Doing so avoids the user having to authorize a different extension to access their Azure subscriptions.
     */
    subscriptionProvider: AzureSubscriptionProvider;

    /**
     * Use this helper to interact with TypeChat.
     *
     * Doing so avoids the user having to authorize a different extension to access the VS Code language model API (since it those APIs are used by TypeChat).
     */
    typeChatHelper: ITypeChatHelper;
};

/**
 * Metadata that the Azure agent attaches to a chat result. When looking at Azure agent response turns in a {@link vscode.ChatContext.history}, it should
 * be expected that this metadata will be present in the {@link vscode.ChatResponseTurn.result}'s metadata.
 *
 * A handler of a command neither needs to nor should create the metadata keys that are defined in this type. Any attempts to do so will be overwritten.
 */
export type AzureAgentChatResultMetadata = {
    /**
     * The chain of slash command handlers that were invoked to produce this result.
     */
    handlerChain: string[];

    /**
     * How the handler was determined.
     */
    handlerDetermination: object;

    /**
     * A unique identifier for the {@link AgentRequest} associated with this result.
     */
    requestId: string;

    /**
     * A unique identifier for the result.
     */
    resultId: string;

    /**
     * The index of the result in the conversation. For example, if the user asks "Foo?" and the agent responds with "Bar.", then the index of the "Bar." result is 1.
     */
    conversationIndex: number;

    /**
     * Properties that can be included in telemetry.
     *
     * If the value is a `string`, it will be included as a telemetry property. If it is a `number`, it will be included as a telemetry measurement.
     */
    telemetryProperties?: { [key: string]: string | number | undefined };

    /**
     * A specific Azure resource that the agent identified as something the user wants to talk about.
     */
    resourceContext?: AzureResourceConnection;

    /**
     * Any additional metadata that was added by some other code.
     */
    [key: string]: unknown;
};

export { LocalPluginManifest };
