import { type DockerfilePlan, type ManifestPlan, formatGenerateDockerfileResult, formatGenerateK8sManifestsResult } from "containerization-assist-mcp/sdk";

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
Based on the analysis and recommendations provided, generate complete Kubernetes YAML manifests.
Follow all security best practices, include resource limits, health checks, and appropriate labels.

IMPORTANT: Generate EACH manifest file separately with its own <content filename="FILENAME"></content> markers.
Do not include any explanations, markdown code fences, or text outside the content markers.
Each file should be a separate, complete YAML document.

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

export function buildK8sManifestUserPrompt(plan: ManifestPlan, appName: string, namespace: string): string {
    const repoInfo = plan.repositoryInfo;
    const formattedPlan = formatGenerateK8sManifestsResult(plan);

    return `Generate Kubernetes manifests based on the following analysis and recommendations:

${formattedPlan}

Application Details:
- Name: ${appName}
- Namespace: ${namespace}
- Language: ${repoInfo?.language || "unknown"}
- Framework: ${repoInfo?.frameworks?.map((f) => f.name).join(", ") || "none"}
- Ports: ${repoInfo?.ports?.join(", ") || "8080"}
- Entry Point: ${repoInfo?.entryPoint || "unknown"}

Generate the following Kubernetes manifest files (each in separate <content filename="..."></content> markers):
1. deployment.yaml - with proper resource limits, health checks, and security context
2. service.yaml - ClusterIP service exposing the application ports
3. ingress.yaml - Ingress resource for external access (use nginx ingress class)

Generate the manifests now:`;
}
