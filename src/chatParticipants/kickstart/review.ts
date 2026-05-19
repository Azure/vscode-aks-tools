import type { GuardrailContribution } from "./guardrails/types";
import { getDefaultGuardrails } from "./guardrails";
import { StagedFile } from "./state";

export interface ReviewFinding {
    filename: string;
    guardrailId: string;
    reason: string;
}

export interface ReviewResult {
    passed: boolean;
    findings: ReviewFinding[];
}

export async function reviewArtifacts(
    files: StagedFile[],
    options?: { guardrails?: GuardrailContribution[]; toolName?: string },
): Promise<ReviewResult> {
    const guardrails = options?.guardrails ?? getDefaultGuardrails();
    const toolName = options?.toolName ?? "write_file";

    const findings: ReviewFinding[] = [];

    for (const file of files) {
        for (const guardrail of guardrails) {
            if (!guardrail.stages.includes("tool")) continue;

            let result;
            try {
                result = await guardrail.evaluate({
                    stage: "tool",
                    toolName,
                    toolArgs: { content: file.content, filename: file.filename },
                });
            } catch {
                findings.push({
                    filename: file.filename,
                    guardrailId: guardrail.id,
                    reason: "Guardrail evaluation failed (fail-closed)",
                });
                continue;
            }

            if (result.verdict === "block") {
                findings.push({
                    filename: file.filename,
                    guardrailId: guardrail.id,
                    reason: result.reason ?? "Blocked by guardrail",
                });
            }
        }
    }

    return { passed: findings.length === 0, findings };
}

export function formatReviewFindings(result: ReviewResult): string {
    if (result.passed) {
        return "✅ **Review passed** — all generated files satisfy safety guardrails.";
    }

    const byFile = new Map<string, ReviewFinding[]>();
    for (const f of result.findings) {
        const list = byFile.get(f.filename) ?? [];
        list.push(f);
        byFile.set(f.filename, list);
    }

    const lines: string[] = ["❌ **Review failed** — generated files violate safety guardrails:\n"];
    for (const [filename, fs] of byFile) {
        lines.push(`**${filename}**`);
        for (const f of fs) {
            lines.push(`  - \`${f.guardrailId}\`: ${f.reason}`);
        }
    }

    return lines.join("\n");
}
