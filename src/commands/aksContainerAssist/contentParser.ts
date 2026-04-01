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
 * Ensures container image references in K8s manifests use the correct imageRepository.
 * Replaces LLM-generated placeholders (e.g. <your-acr-name>.azurecr.io/app) with the real value.
 */
export function fixManifestImageReferences(manifests: ParsedManifest[], imageRepository: string): ParsedManifest[] {
    const segments = imageRepository.split("/");
    const appSegment = segments[segments.length - 1];

    // Pattern 1: <placeholder>.azurecr.io/path or name.azurecr.io/path
    const acrPattern =
        /(?:<[^>]+>|\$\{[^}]+\}|\{\{[^}]+\}\}|[a-zA-Z0-9._-]+)\.azurecr\.io\/([a-zA-Z0-9._/-]+)(?=\s|"|'|>|\)|$|:)/g;

    // Pattern 2: bare image reference — "image-name:tag" or "image-name" without any slash
    return manifests.map((m) => {
        // Pass 1 — fix ACR-prefixed placeholders
        let fixed = m.content.replace(acrPattern, (match, capturedPath: string) => {
            const lastSegment = capturedPath.split("/").pop();
            return lastSegment === appSegment ? imageRepository : match;
        });

        // Pass 2 — fix bare image references whose name matches the app segment.
        // Only replace inside YAML "image:" lines to avoid touching unrelated fields.
        fixed = fixed.replace(/^(\s*image:\s*)(.+)$/gm, (line, prefix, imagePart) => {
            // Skip if it already looks like a full registry URL (contains a dot before the first slash)
            if (/^[a-zA-Z0-9._-]+\.[a-zA-Z]{2,}\//.test(imagePart.trim())) {
                return line;
            }
            // Extract the image name (strip tag)
            const imageName = imagePart.trim().split(":")[0].split("/").pop() ?? "";
            if (imageName === appSegment) {
                return `${prefix}${imageRepository}`;
            }
            return line;
        });

        return { ...m, content: fixed };
    });
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
