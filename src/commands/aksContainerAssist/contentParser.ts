const MARKDOWN_FENCE_REGEX = {
    dockerfile: /^```(?:dockerfile|docker)?\n?|```$/gim,
    yaml: /^```ya?ml?\n?|```$/gim,
};

const CONTENT_MARKER_REGEX = /<content>([\s\S]*?)<\/content>/gi;
const CONTENT_WITH_FILENAME_REGEX = /<content\s+filename=["']([^"']+)["']>([\s\S]*?)<\/content>/gi;

export type ContentType = "dockerfile" | "yaml";

export interface ParsedManifest {
    filename: string;
    content: string;
}

export function cleanMarkdownFences(content: string, type: ContentType): string {
    return content.replace(MARKDOWN_FENCE_REGEX[type], "").trim();
}

export function extractContent(response: string, type: ContentType): string {
    const matches = [...response.matchAll(CONTENT_MARKER_REGEX)];
    if (matches.length === 0) {
        return cleanMarkdownFences(response, type);
    }
    return matches.map((m) => m[1].trim()).join("\n---\n");
}

export function parseManifestsFromLMResponse(content: string, appName: string): ParsedManifest[] {
    const manifestsWithFilenames = parseContentWithFilenames(content);
    if (manifestsWithFilenames.length > 0) {
        return manifestsWithFilenames;
    }

    const simpleMatches = [...content.matchAll(CONTENT_MARKER_REGEX)];
    if (simpleMatches.length > 0) {
        const combinedContent = simpleMatches.map((m) => m[1].trim()).join("\n---\n");
        return parseYamlDocuments(combinedContent, appName);
    }

    const cleanedContent = cleanMarkdownFences(content, "yaml");
    return parseYamlDocuments(cleanedContent, appName);
}

function parseContentWithFilenames(content: string): ParsedManifest[] {
    const manifests: ParsedManifest[] = [];
    let match;

    while ((match = CONTENT_WITH_FILENAME_REGEX.exec(content)) !== null) {
        const filename = match[1];
        const fileContent = match[2].trim();
        if (filename && fileContent) {
            manifests.push({ filename, content: fileContent });
        }
    }

    return manifests;
}

export function parseYamlDocuments(content: string, appName: string): ParsedManifest[] {
    const documents = content.split(/^---$/m).filter((doc) => doc.trim());
    if (documents.length === 0) {
        return [];
    }

    const manifests: ParsedManifest[] = documents.map((doc, index) => {
        const trimmedDoc = doc.trim();
        const filename = extractFilename(trimmedDoc, appName, index);
        const contentWithoutComment = trimmedDoc.replace(/^#\s*[\w-]+\.ya?ml\s*\n/i, "").trim();
        return { filename, content: contentWithoutComment };
    });

    if (manifests.length === 1) {
        const hasDeployment = manifests[0].filename.toLowerCase().includes("deployment");
        const hasService = manifests[0].filename.toLowerCase().includes("service");
        if (!hasDeployment && !hasService) {
            manifests[0].filename = "deployment.yaml";
        }
    }

    return manifests;
}

function extractFilename(doc: string, appName: string, index: number): string {
    // Check for explicit filename comment
    const filenameMatch = doc.match(/^#\s*([\w-]+\.ya?ml)/i);
    if (filenameMatch) {
        return filenameMatch[1];
    }

    // Extract from kind field
    const kindMatch = doc.match(/kind:\s*(\w+)/i);
    if (kindMatch) {
        return `${kindMatch[1].toLowerCase()}.yaml`;
    }

    return `${appName}-manifest-${index + 1}.yaml`;
}
