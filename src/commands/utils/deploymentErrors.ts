import { getErrorMessage } from "./errorable";

interface DeploymentErrorNode {
    code?: string;
    message?: string;
    details?: DeploymentErrorNode[];
}

interface ArmErrorBody {
    error?: DeploymentErrorNode;
}

export function getDeploymentErrorMessage(ex: unknown): string {
    const root = getDeploymentErrorRoot(ex);
    if (root) {
        const leaves: string[] = [];
        collectLeafMessages(root, leaves);
        const unique = [...new Set(leaves)].filter((m) => m.length > 0);
        if (unique.length > 0) {
            return unique.join("\n");
        }
        const formatted = formatNode(root);
        if (formatted.length > 0) {
            return formatted;
        }
    }
    return getErrorMessage(ex);
}

export function getDeploymentErrorDetails(ex: unknown): string | undefined {
    const body = getDeploymentErrorBody(ex);
    if (!body) {
        return undefined;
    }
    try {
        return JSON.stringify(body, null, 2);
    } catch {
        return undefined;
    }
}

function getDeploymentErrorRoot(ex: unknown): DeploymentErrorNode | undefined {
    const body = getDeploymentErrorBody(ex);
    if (body && typeof body.error === "object" && body.error !== null) {
        return body.error;
    }
    return undefined;
}

function getDeploymentErrorBody(ex: unknown): ArmErrorBody | undefined {
    if (typeof ex !== "object" || ex === null) {
        return undefined;
    }
    const details = (ex as { details?: unknown }).details;
    if (isArmErrorBody(details)) {
        return details;
    }
    const response = (ex as { response?: unknown }).response;
    if (typeof response === "object" && response !== null) {
        const parsedBody = (response as { parsedBody?: unknown }).parsedBody;
        if (isArmErrorBody(parsedBody)) {
            return parsedBody;
        }
        const bodyAsText = (response as { bodyAsText?: unknown }).bodyAsText;
        if (typeof bodyAsText === "string" && bodyAsText.length > 0) {
            const parsed = tryParseJson(bodyAsText);
            if (isArmErrorBody(parsed)) {
                return parsed;
            }
        }
    }
    return undefined;
}

function isArmErrorBody(value: unknown): value is ArmErrorBody {
    return typeof value === "object" && value !== null && "error" in value;
}

function tryParseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

function collectLeafMessages(node: DeploymentErrorNode, acc: string[]): void {
    const children = Array.isArray(node.details) ? node.details : [];
    if (children.length > 0) {
        for (const child of children) {
            collectLeafMessages(child, acc);
        }
        return;
    }
    acc.push(formatNode(node));
}

function formatNode(node: DeploymentErrorNode): string {
    const code = typeof node.code === "string" ? node.code.trim() : "";
    const message = typeof node.message === "string" ? node.message.trim() : "";
    if (code.length > 0 && message.length > 0) {
        return `${code}: ${message}`;
    }
    return message.length > 0 ? message : code;
}
