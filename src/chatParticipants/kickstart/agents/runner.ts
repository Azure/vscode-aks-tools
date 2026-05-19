import * as vscode from "vscode";
import { LMClient } from "../../../commands/aksContainerAssist/lmClient";
import { failed } from "../../../commands/utils/errorable";
import type { Agent, AgentRunResult, AgentTurn, HandoffRequest } from "./types";
import { HANDOFF_TOOL, HANDOFF_TOOL_NAME, parseHandoffCall } from "./handoff";

const DEFAULT_MAX_HANDOFFS = 5;

export interface AgentRegistry {
    get(name: string): Agent | undefined;
    list(): Agent[];
}

export class InMemoryAgentRegistry implements AgentRegistry {
    private agents = new Map<string, Agent>();

    register(agent: Agent): void {
        this.agents.set(agent.name, agent);
    }

    get(name: string): Agent | undefined {
        return this.agents.get(name);
    }

    list(): Agent[] {
        return Array.from(this.agents.values());
    }
}

export interface AgentRunOptions {
    initialAgent: string;
    userMessage: string;
    registry: AgentRegistry;
    lmClient: LMClient;
    toolHandler: (call: vscode.LanguageModelToolCallPart) => Promise<string>;
    maxHandoffs?: number;
    token?: vscode.CancellationToken;
}

export async function runAgents(options: AgentRunOptions): Promise<AgentRunResult> {
    const maxHandoffs = options.maxHandoffs ?? DEFAULT_MAX_HANDOFFS;
    const turns: AgentTurn[] = [];
    const handoffs: HandoffRequest[] = [];

    let currentAgentName = options.initialAgent;
    let currentMessage = options.userMessage;

    for (let i = 0; i <= maxHandoffs; i++) {
        const agent = options.registry.get(currentAgentName);
        if (!agent) {
            return {
                turns,
                finalAgent: currentAgentName,
                handoffs,
                completed: false,
            };
        }

        const allowedHandoffs = (agent.handoffTargets ?? []).filter((name) => options.registry.get(name) !== undefined);
        const toolsForAgent = allowedHandoffs.length > 0 ? [...agent.tools, HANDOFF_TOOL] : agent.tools;

        let pendingHandoff: HandoffRequest | undefined;

        const wrappedToolHandler = async (call: vscode.LanguageModelToolCallPart): Promise<string> => {
            const handoff = parseHandoffCall(call);
            if (handoff) {
                if (!allowedHandoffs.includes(handoff.toAgent)) {
                    return `Handoff rejected: "${handoff.toAgent}" is not a valid handoff target for ${agent.name}. Allowed: ${allowedHandoffs.join(", ") || "(none)"}.`;
                }
                pendingHandoff = handoff;
                return `Handoff acknowledged. Conversation will transfer to ${handoff.toAgent}.`;
            }
            return options.toolHandler(call);
        };

        const result = await options.lmClient.sendRequestWithTools(
            agent.systemPrompt,
            currentMessage,
            {
                tools: toolsForAgent,
                toolHandler: wrappedToolHandler,
                guardrails: agent.guardrails,
                agentName: agent.name,
            },
            options.token,
        );

        if (failed(result)) {
            turns.push({ agentName: agent.name, userMessage: currentMessage, response: `Error: ${result.error}` });
            return { turns, finalAgent: agent.name, handoffs, completed: false };
        }

        turns.push({ agentName: agent.name, userMessage: currentMessage, response: result.result });

        if (!pendingHandoff) {
            return { turns, finalAgent: agent.name, handoffs, completed: true };
        }

        handoffs.push(pendingHandoff);
        currentAgentName = pendingHandoff.toAgent;
        currentMessage = pendingHandoff.summary;
    }

    return { turns, finalAgent: currentAgentName, handoffs, completed: false };
}

export { HANDOFF_TOOL_NAME };
