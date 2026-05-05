import { reporter } from "../../commands/utils/reporter";

export function reportKickstartTelemetry(event: string, props?: Record<string, string>): void {
    reporter?.sendTelemetryEvent(`chat.kickstart.${event}`, props);
}
