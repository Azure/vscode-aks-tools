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
    // Reset lastIndex: the regex has the 'g' flag, so it persists state across calls.
    CONTENT_WITH_FILENAME_REGEX.lastIndex = 0;

    const manifests: ParsedManifest[] = [];
    let match;

    while ((match = CONTENT_WITH_FILENAME_REGEX.exec(content)) !== null) {
        const rawFilename = match[1];
        const fileContent = match[2].trim();
        if (rawFilename && fileContent) {
            // Strip any leading directory prefix the LM may include
            // (e.g. "k8s/deployment.yaml" → "deployment.yaml").
            const stripped = rawFilename.replace(/^(?:\.\/)?(?:[^/]+\/)+/, "");
            // Fall back to basename of rawFilename if stripped is empty (e.g. "k8s/").
            const filename = stripped || rawFilename.split("/").filter(Boolean).pop() || rawFilename;
            manifests.push({ filename, content: fileContent });
        }
    }

    return manifests;
}

export function parseYamlDocuments(content: string, appName: string): ParsedManifest[] {
    const documents = content.split(/^---\s*$/m).filter((doc) => doc.trim());
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
        const fn = manifests[0].filename.toLowerCase();
        // Only rename fallback-named manifests (e.g. "appname-manifest-1.yaml"),
        // not those derived from a YAML kind or explicit filename comment.
        const isFallbackName = fn.includes("-manifest-");
        if (isFallbackName) {
            manifests[0].filename = "deployment.yaml";
        }
    }

    return manifests;
}

/**
 * Ensures container image references in K8s manifests use the correct ACR imageRepository.
 * Handles LLM-generated placeholders (e.g. <your-acr-name>.azurecr.io/app), wrong ACR names,
 * and bare image names (e.g. my-app:1.0.0) by checking each "image:" line against the
 * user-selected ACR repository.
 */
export function fixManifestImageReferences(manifests: ParsedManifest[], imageRepository: string): ParsedManifest[] {
    const segments = imageRepository.split("/");
    const appSegment = segments[segments.length - 1];

    return manifests.map((m) => ({
        ...m,
        content: m.content.replace(/^(\s*image:\s*)(.+)$/gm, (line, prefix, imagePart) => {
            const trimmed = imagePart.trim();
            // Already correct — starts with the expected ACR repo
            if (trimmed.startsWith(imageRepository)) return line;
            // Extract the base image name (rightmost path segment, without tag or digest)
            const baseName = (trimmed.split("/").pop() ?? trimmed).split(":")[0].split("@")[0];
            return baseName === appSegment ? `${prefix}${imageRepository}` : line;
        }),
    }));
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
