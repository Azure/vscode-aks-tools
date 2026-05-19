import * as vscode from "vscode";

export const HANDOFF_TOOL_NAME = "handoff_to_agent";

export const HANDOFF_TOOL: vscode.LanguageModelChatTool = {
    name: HANDOFF_TOOL_NAME,
    description:
        "Hand off the conversation to another agent. Use when your role is complete and a different agent should take over. " +
        "Provide a concise summary of what you accomplished and what the next agent needs to do.",
    inputSchema: {
        type: "object",
        properties: {
            toAgent: {
                type: "string",
                description: "Name of the agent to hand off to (must be a valid handoff target).",
            },
            summary: {
                type: "string",
                description:
                    "Brief summary of work done and the goal for the next agent. Will be passed as the next agent's input.",
            },
        },
        required: ["toAgent", "summary"],
    },
};

export interface ParsedHandoff {
    toAgent: string;
    summary: string;
}

export function parseHandoffCall(call: vscode.LanguageModelToolCallPart): ParsedHandoff | undefined {
    if (call.name !== HANDOFF_TOOL_NAME) return undefined;
    const input = call.input as Record<string, unknown>;
    if (typeof input.toAgent !== "string" || typeof input.summary !== "string") {
        return undefined;
    }
    return { toAgent: input.toAgent, summary: input.summary };
}
