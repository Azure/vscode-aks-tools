import {
    type DockerfilePlan,
    type ManifestPlan,
    formatGenerateDockerfileResult,
    formatGenerateK8sManifestsResult,
} from "containerization-assist-mcp/sdk";

const WEB_FRAMEWORK_REGEX = /express|fastify|flask|django|spring|asp\.net|gin|echo|fiber|actix/i;
const EXTERNAL_DEPENDENCY_REGEX = /redis|postgres|mysql|mongo|rabbitmq|kafka|elasticsearch/i;

export const DOCKERFILE_SYSTEM_PROMPT = `You are an expert at creating optimized, production-ready Dockerfiles.
Based on the analysis and recommendations provided, generate a complete Dockerfile.
Follow all security best practices, use multi-stage builds when recommended, and include appropriate comments.

IMPORTANT: Your response must contain ONLY the Dockerfile content wrapped in <content></content> markers.
Do not include any explanations, markdown code fences, or text outside the content markers.

Example response format:
<content>
FROM node:20-alpine
# ... rest of Dockerfile
</content>`;

export const K8S_MANIFEST_SYSTEM_PROMPT = `You are an expert at creating production-ready Kubernetes manifests.
Based on the analysis and recommendations provided, generate ONLY the Kubernetes YAML manifests that are necessary for this specific application.

Guidelines:
- ALWAYS generate: deployment.yaml (required for any application)
- Generate service.yaml ONLY if the application exposes ports or is a web service/API
- Generate ingress.yaml ONLY if external HTTP/HTTPS access is needed (web apps, APIs)
- Generate configmap.yaml ONLY if there are environment variables or configuration needed
- Generate secret.yaml ONLY if there are sensitive credentials referenced
- DO NOT generate manifests that aren't needed for the application type

Follow security best practices: include resource limits, security context, and appropriate labels.

IMPORTANT: Generate EACH manifest file separately with its own <content filename="FILENAME"></content> markers.
Do not include any explanations, markdown code fences, or text outside the content markers.

Example response format:
<content filename="deployment.yaml">
apiVersion: apps/v1
kind: Deployment
# ... rest of deployment
</content>
<content filename="service.yaml">
apiVersion: v1
kind: Service
# ... rest of service
</content>`;

export function buildDockerfileUserPrompt(plan: DockerfilePlan): string {
    const repoInfo = plan.repositoryInfo;
    const formattedPlan = formatGenerateDockerfileResult(plan);

    let prompt = `Generate a Dockerfile based on the following analysis and recommendations:

${formattedPlan}

Repository Info:
- Language: ${repoInfo?.language || "unknown"}
- Framework: ${repoInfo?.frameworks?.map((f) => f.name).join(", ") || "none"}
- Entry Point: ${repoInfo?.entryPoint || "unknown"}
- Ports: ${repoInfo?.ports?.join(", ") || "none detected"}`;

    if (plan.existingDockerfile) {
        const guidance = plan.existingDockerfile.guidance;
        prompt += `

Existing Dockerfile to enhance:
${plan.existingDockerfile.content}

Enhancement guidance:
- Preserve: ${guidance.preserve.join(", ")}
- Improve: ${guidance.improve.join(", ")}
- Add missing: ${guidance.addMissing.join(", ")}`;
    }

    prompt += "\n\nGenerate the complete Dockerfile now. Remember to wrap the output in <content></content> markers:";
    return prompt;
}

export function buildK8sManifestUserPrompt(
    plan: ManifestPlan,
    appName: string,
    namespace: string,
    imageRepository?: string,
): string {
    const repoInfo = plan.repositoryInfo;
    const formattedPlan = formatGenerateK8sManifestsResult(plan);

    const ports = repoInfo?.ports || [];
    const dependencies = repoInfo?.dependencies || [];
    const frameworks = repoInfo?.frameworks?.map((f) => f.name) || [];

    const isWebApp = ports.length > 0 || frameworks.some((f) => WEB_FRAMEWORK_REGEX.test(f));
    const hasExternalDependencies = dependencies.some((d) => EXTERNAL_DEPENDENCY_REGEX.test(d));

    const manifestGuidance = buildManifestGuidance(isWebApp, hasExternalDependencies, ports);

    const imageLine = imageRepository ? `- Image Repository: ${imageRepository}` : undefined;

    return `Generate Kubernetes manifests based on the following analysis and recommendations:

${formattedPlan}

Application Details:
- Name: ${appName}
- Namespace: ${namespace}
- Language: ${repoInfo?.language || "unknown"}
- Framework: ${frameworks.join(", ") || "none"}
- Ports: ${ports.join(", ") || "none detected"}
- Entry Point: ${repoInfo?.entryPoint || "unknown"}
- Dependencies: ${dependencies.join(", ") || "none"}
${imageLine ? `${imageLine}` : ""}
${manifestGuidance}

Generate ONLY the manifests that are appropriate for this application.
Each manifest should be in a separate <content filename="..."></content> block:`;
}

function buildManifestGuidance(isWebApp: boolean, hasExternalDependencies: boolean, ports: number[]): string {
    let guidance = `
Based on the analysis, determine which manifests are needed:
- deployment.yaml: REQUIRED (always generate this)`;

    if (isWebApp) {
        guidance += `
- service.yaml: REQUIRED (application exposes ports: ${ports.join(", ") || "detected as web app"})`;
    } else {
        guidance += `
- service.yaml: Generate ONLY if the application needs to be accessed by other services`;
    }

    guidance += isWebApp
        ? `
- ingress.yaml: RECOMMENDED (web application that may need external access)`
        : `
- ingress.yaml: NOT NEEDED (not a web-facing application)`;

    if (hasExternalDependencies) {
        guidance += `
- configmap.yaml: RECOMMENDED (external dependencies detected: configure connection strings)`;
    }

    return guidance;
}
