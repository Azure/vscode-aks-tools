import type * as vscode from "vscode";
import type { GuardrailContribution } from "../guardrails/types";

export interface Agent {
    name: string;
    description: string;
    systemPrompt: string;
    tools: vscode.LanguageModelChatTool[];
    handoffTargets?: string[];
    guardrails?: GuardrailContribution[];
}

export interface AgentTurn {
    agentName: string;
    userMessage: string;
    response: string;
}

export interface HandoffRequest {
    toAgent: string;
    summary: string;
}

export interface AgentRunResult {
    turns: AgentTurn[];
    finalAgent: string;
    handoffs: HandoffRequest[];
    completed: boolean;
}
