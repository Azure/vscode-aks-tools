const MARKDOWN_FENCE_PATTERNS = {
    dockerfile: [/^```dockerfile\n?/i, /^```docker\n?/i, /^```\n?/, /\n?```$/],
    yaml: [/^```ya?ml\n?/gi, /^```\n?/, /\n?```$/],
};

const CONTENT_MARKER_REGEX = /<content>([\s\S]*?)<\/content>/gi;

export type ContentType = "dockerfile" | "yaml";

export interface ParsedManifest {
    filename: string;
    content: string;
}

export function cleanMarkdownFences(content: string, type: ContentType): string {
    const patterns = MARKDOWN_FENCE_PATTERNS[type];
    let cleaned = content;
    for (const pattern of patterns) {
        cleaned = cleaned.replace(pattern, "");
    }
    return cleaned.trim();
}

export function extractContent(response: string, type: ContentType): string {
    const matches = [...response.matchAll(CONTENT_MARKER_REGEX)];
    if (matches.length > 0) {
        return matches.map(m => m[1].trim()).join("\n---\n");
    }
    return cleanMarkdownFences(response, type);
}

export function parseManifestsFromLMResponse(content: string, appName: string): ParsedManifest[] {
    const manifests: ParsedManifest[] = [];
    const contentWithFilenameRegex = /<content\s+filename=["']([^"']+)["']>([\s\S]*?)<\/content>/gi;
    let match;
    
    while ((match = contentWithFilenameRegex.exec(content)) !== null) {
        const filename = match[1];
        const fileContent = match[2].trim();
        if (filename && fileContent) {
            manifests.push({ filename, content: fileContent });
        }
    }

    if (manifests.length > 0) {
        return manifests;
    }

    const simpleContentRegex = /<content>([\s\S]*?)<\/content>/gi;
    const simpleMatches = [...content.matchAll(simpleContentRegex)];
    
    if (simpleMatches.length > 0) {
        const combinedContent = simpleMatches.map(m => m[1].trim()).join("\n---\n");
        return parseYamlDocuments(combinedContent, appName);
    }

    const cleanedContent = cleanMarkdownFences(content, "yaml");
    return parseYamlDocuments(cleanedContent, appName);
}

export function parseYamlDocuments(content: string, appName: string): ParsedManifest[] {
    const manifests: ParsedManifest[] = [];
    const documents = content.split(/^---$/m).filter((doc) => doc.trim());

    for (const doc of documents) {
        const trimmedDoc = doc.trim();
        if (!trimmedDoc) continue;

        const filenameMatch = trimmedDoc.match(/^#\s*([\w-]+\.ya?ml)/i);
        let filename: string;

        if (filenameMatch) {
            filename = filenameMatch[1];
        } else {
            const kindMatch = trimmedDoc.match(/kind:\s*(\w+)/i);
            if (kindMatch) {
                filename = `${kindMatch[1].toLowerCase()}.yaml`;
            } else {
                filename = `${appName}-manifest-${manifests.length + 1}.yaml`;
            }
        }

        const contentWithoutComment = trimmedDoc.replace(/^#\s*[\w-]+\.ya?ml\s*\n/i, "").trim();
        manifests.push({ filename, content: contentWithoutComment });
    }

    const hasDeployment = manifests.some((m) => m.filename.toLowerCase().includes("deployment"));
    const hasService = manifests.some((m) => m.filename.toLowerCase().includes("service"));

    if (!hasDeployment && !hasService && manifests.length === 1) {
        manifests[0].filename = "deployment.yaml";
    }

    return manifests;
}
