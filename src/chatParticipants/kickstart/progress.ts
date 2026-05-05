import { Phase, KickstartState } from "./state";

/**
 * Phase display information with emoji and name
 */
interface PhaseInfo {
    emoji: string;
    name: string;
}

/**
 * Phase mapping with emojis and display names
 */
const PHASES: PhaseInfo[] = [
    { emoji: "🔍", name: "Analyze" },
    { emoji: "⚙️", name: "Configure" },
    { emoji: "📦", name: "Prepare" },
    { emoji: "🔨", name: "Build" },
    { emoji: "🚀", name: "Deploy" },
    { emoji: "✅", name: "Verify" },
];

/**
 * Converts a Phase enum value to a display name
 * @param phase The phase to convert
 * @returns The display name for the phase
 */
export function phaseName(phase: Phase): string {
    if (phase === Phase.COMPLETE) {
        return "Complete";
    }
    if (phase >= 0 && phase < PHASES.length) {
        return PHASES[phase].name;
    }
    return "Unknown";
}

/**
 * Renders a visual progress bar showing the current phase
 * Completed phases are struck through, current phase is bolded with arrow
 * @param currentPhase The current phase
 * @returns Markdown string with phase progress bar
 */
export function renderProgress(currentPhase: Phase): string {
    const progressItems: string[] = [];

    // Build the progress bar
    for (let i = 0; i < PHASES.length; i++) {
        const phase = PHASES[i];
        let item = `${phase.emoji} ${phase.name}`;

        if (i < currentPhase) {
            // Past phases are struck through
            item = `~~${item}~~`;
        } else if (i === currentPhase) {
            // Current phase is bolded with arrow
            item = `**${item} ←**`;
        }
        // Future phases are plain text

        progressItems.push(item);
    }

    return progressItems.join("  ·  ");
}

/**
 * Renders a summary of completed phases based on the current state
 * @param state The kickstart state
 * @returns Markdown string summarizing completed phases
 */
export function renderStateSummary(state: KickstartState): string {
    const lines: string[] = ["### Completed Steps"];

    // Check and render completed phases
    if (state.analysis) {
        const language = state.analysis.language;
        lines.push(`- ✅ **Analyzed** your ${language} project`);
    }

    if (state.config) {
        lines.push(
            `- ✅ **Configured** cluster: ${state.config.clusterName}, registry: ${state.config.acrLoginServer}`,
        );
    }

    if (state.artifacts) {
        lines.push(`- ✅ **Prepared** deployment files`);
    }

    if (state.image) {
        lines.push(`- ✅ **Built** and **pushed** image: ${state.image.repository}:${state.image.tag}`);
    }

    if (state.deployment) {
        lines.push(`- ✅ **Deployed** ${state.deployment.appliedManifests.length} manifest(s)`);
    }

    if (state.verification) {
        const statusMessage = state.verification.podsReady ? "ready" : "verifying";
        lines.push(`- ✅ **Verified** deployment (pods ${statusMessage})`);
    }

    // Add current phase if in progress
    if (state.currentPhase <= Phase.VERIFY && !state.analysis) {
        const currentName = phaseName(state.currentPhase);
        lines.push(`- 📦 **${currentName}**...`);
    }

    return lines.join("\n");
}
