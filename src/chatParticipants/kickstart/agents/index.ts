export type { Agent, AgentTurn, HandoffRequest, AgentRunResult } from "./types";
export { runAgents, InMemoryAgentRegistry, HANDOFF_TOOL_NAME } from "./runner";
export type { AgentRegistry, AgentRunOptions } from "./runner";
export { HANDOFF_TOOL, parseHandoffCall } from "./handoff";
export type { ParsedHandoff } from "./handoff";
export {
    triageAgent,
    codesmithAgent,
    reviewerAgent,
    TRIAGE_AGENT_NAME,
    CODESMITH_AGENT_NAME,
    REVIEWER_AGENT_NAME,
    getBuiltInAgents,
} from "./builtin";

import { InMemoryAgentRegistry } from "./runner";
import { getBuiltInAgents } from "./builtin";

export function createDefaultRegistry(): InMemoryAgentRegistry {
    const registry = new InMemoryAgentRegistry();
    for (const agent of getBuiltInAgents()) {
        registry.register(agent);
    }
    return registry;
}
