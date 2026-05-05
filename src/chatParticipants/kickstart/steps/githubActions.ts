import * as vscode from "vscode";
import { LMClient } from "../../../commands/aksContainerAssist/lmClient";
import { extractContent } from "../../../commands/aksContainerAssist/contentParser";
import { Errorable, failed } from "../../../commands/utils/errorable";
import { AnalysisResult } from "./analyze";

export async function generateGithubActionsStep(
    analysis: AnalysisResult,
    lmClient: LMClient,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    projectPath: string,
    options?: { acrLoginServer?: string; clusterName?: string; resourceGroup?: string },
): Promise<Errorable<{ workflow: string }>> {
    const acrRef = options?.acrLoginServer ?? "${{ secrets.ACR_LOGIN_SERVER }}";
    const clusterRef = options?.clusterName ?? "${{ secrets.AKS_CLUSTER_NAME }}";
    const rgRef = options?.resourceGroup ?? "${{ secrets.AZURE_RESOURCE_GROUP }}";
    const lang = analysis.modules[0]?.language ?? "unknown";
    const prompt = `Generate a GitHub Actions workflow YAML file for a ${lang} application that:
1. Builds a Docker image and pushes to ACR: ${acrRef}
2. Deploys to AKS cluster: ${clusterRef} in resource group: ${rgRef}
3. Uses OIDC federation for Azure authentication (azure/login@v2)
4. Uses azure/aks-set-context@v4 and azure/k8s-deploy@v5
${!options?.acrLoginServer ? "Add a comment block at the top listing all secrets that need to be configured." : ""}
Output ONLY the YAML file content, no explanation.`;

    const response = await lmClient.sendRequestWithTools(
        "You are a GitHub Actions expert.",
        prompt,
        { tools: [], toolHandler: async () => "" },
        token,
    );

    if (failed(response)) {
        stream.markdown(`**GitHub Actions workflow error:** ${response.error}`);
        return response;
    }

    const workflow = extractContent(response.result, "yaml");
    stream.markdown(`**.github/workflows/aks-deploy.yml**\n\`\`\`yaml\n${workflow}\n\`\`\``);
    stream.button({
        command: "aks.kickstart.saveFile",
        title: "Save GitHub Actions workflow",
        arguments: [{ filename: ".github/workflows/aks-deploy.yml", content: workflow, projectPath }],
    });

    return { succeeded: true, result: { workflow } };
}
