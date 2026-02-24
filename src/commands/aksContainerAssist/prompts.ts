import {
    type DockerfilePlan,
    type ManifestPlan,
    formatGenerateDockerfileResult,
    formatGenerateK8sManifestsResult,
} from "containerization-assist-mcp/sdk";

const WEB_FRAMEWORK_REGEX = /express|fastify|flask|django|spring|asp\.net|gin|echo|fiber|actix/i;
const EXTERNAL_DEPENDENCY_REGEX = /redis|postgres|mysql|mongo|rabbitmq|kafka|elasticsearch/i;

export const DOCKERFILE_SYSTEM_PROMPT = `You are an expert at creating optimized, production-ready Dockerfiles.
You have access to tools that let you inspect the project:
- readProjectFile: Read any file in the project (source code, config, etc.). Path is relative to project root.
- listDirectory: List files and subdirectories to understand project structure.

WORKFLOW:
1. Review the analysis and recommendations provided in the user message.
2. BEFORE generating the Dockerfile, use readProjectFile to verify critical details:
   - The entry point file exists at the expected path
   - The build configuration matches detected settings (tsconfig.json outDir, package.json scripts, pom.xml packaging, etc.)
   - Any framework-specific configuration
3. If the analysis says "unknown" for entry point or other critical fields, use listDirectory and readProjectFile to find the correct values.
4. Generate the Dockerfile based on ACTUAL project files, not assumptions.

IMPORTANT: Your final response must contain ONLY the Dockerfile content wrapped in <content></content> markers.
Do not include any explanations, markdown code fences, or text outside the content markers.

Example response format:
<content>
FROM node:20-alpine
# ... rest of Dockerfile
</content>`;

export const K8S_MANIFEST_SYSTEM_PROMPT = `You are an expert at creating production-ready Kubernetes manifests.
You have access to tools that let you inspect the project:
- readProjectFile: Read any file in the project (source code, config, Dockerfile, etc.). Path is relative to project root.
- listDirectory: List files and subdirectories to understand project structure.

WORKFLOW:
1. Review the analysis and recommendations provided in the user message.
2. BEFORE generating manifests, use readProjectFile to verify critical details:
   - Read the Dockerfile (if it exists) to determine the EXPOSE port, ENTRYPOINT, and health check paths.
   - Check configuration files for environment variables, secrets, or external service references.
   - Verify the application type (web server, worker, CLI tool) to decide which manifests are needed.
3. If the analysis says "unknown" for ports or other critical fields, use tools to find the correct values.
4. Generate manifests based on ACTUAL project files, not assumptions.

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
- Framework: ${repoInfo?.frameworks?.map((f) => `${f.name}${f.version ? ` v${f.version}` : ""}`).join(", ") || "none"}
- Entry Point: ${repoInfo?.entryPoint || "unknown — use readProjectFile to find it"}
- Ports: ${repoInfo?.ports?.join(", ") || "none detected"}
- Dependencies: ${repoInfo?.dependencies?.slice(0, 15).join(", ") || "none"}`;

    // Add verification hints for fields the deterministic analysis couldn't resolve
    const verificationHints: string[] = [];

    if (!repoInfo?.entryPoint || repoInfo.entryPoint === "unknown" || repoInfo.entryPoint.trim() === "") {
        verificationHints.push(
            "- Entry point is unknown. Use listDirectory to find source files, then readProjectFile to identify the main entry point.",
        );
    }

    if (!repoInfo?.ports || repoInfo.ports.length === 0) {
        verificationHints.push("- No ports detected. Check config files or source code for port configuration.");
    }

    const lang = repoInfo?.language;
    if (lang === "typescript" || lang === "javascript") {
        verificationHints.push(
            "- Check package.json 'scripts.build' and tsconfig.json 'outDir' to determine build output path for COPY instructions.",
        );
    } else if (lang === "java") {
        verificationHints.push(
            "- Check pom.xml or build.gradle for packaging type (jar/war) and artifact name for the COPY instruction.",
        );
    } else if (lang === "dotnet") {
        verificationHints.push(
            "- Check the .csproj file for AssemblyName and TargetFramework to construct the correct ENTRYPOINT.",
        );
    } else if (lang === "go") {
        verificationHints.push(
            "- Check go.mod for the module name and look for cmd/ directory or main.go to determine the binary name.",
        );
    } else if (lang === "rust") {
        verificationHints.push(
            "- Check Cargo.toml for the package name and [[bin]] targets to determine the binary output path.",
        );
    } else if (lang === "python") {
        verificationHints.push(
            "- Look for manage.py (Django), app.py/main.py (Flask/FastAPI), or pyproject.toml scripts to determine the run command.",
        );
    }

    if (verificationHints.length > 0) {
        prompt += `\n\nVerification needed (use tools to resolve before generating):\n${verificationHints.join("\n")}`;
    }

    if (plan.existingDockerfile) {
        const guidance = plan.existingDockerfile.guidance;
        prompt += `\n\nExisting Dockerfile to enhance:\n${plan.existingDockerfile.content}\n\nEnhancement guidance:\n- Preserve: ${guidance.preserve.join(", ")}\n- Improve: ${guidance.improve.join(", ")}\n- Add missing: ${guidance.addMissing.join(", ")}`;
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
- Ports: ${ports.join(", ") || "none detected — use readProjectFile to check the Dockerfile or source code"}
- Entry Point: ${repoInfo?.entryPoint || "unknown"}
- Dependencies: ${dependencies.join(", ") || "none"}
${imageLine ? `${imageLine}` : ""}
${manifestGuidance}
${buildK8sVerificationHints(ports, repoInfo?.entryPoint)}
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

function buildK8sVerificationHints(ports: number[], entryPoint: string | undefined): string {
    const hints: string[] = [];

    hints.push(
        "- Read the Dockerfile (if present) with readProjectFile to confirm EXPOSE ports and ENTRYPOINT for accurate containerPort and health check configuration.",
    );

    if (!ports || ports.length === 0) {
        hints.push(
            "- No ports detected. Use readProjectFile to check the Dockerfile EXPOSE directive or source code for port configuration before choosing containerPort.",
        );
    }

    if (!entryPoint || entryPoint === "unknown" || entryPoint.trim() === "") {
        hints.push(
            "- Entry point is unknown. Check the Dockerfile or source code to determine if the app is a web server, worker, or CLI tool — this affects which manifests to generate.",
        );
    }

    return hints.length > 0
        ? `\nVerification needed (use tools to resolve before generating):\n${hints.join("\n")}`
        : "";
}
