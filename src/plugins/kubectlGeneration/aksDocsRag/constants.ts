export const aksDocsRAGScopes = ["https://management.core.windows.net/.default"];

export const aksDocsRAGEndpoint = "https://pcnx-copilot-aqebbkc6frhyhkbx.z01.azurefd.net/aks-docs-rag-mid";

export const aksDocsRAGTenantId = "72f988bf-86f1-41af-91ab-2d7cd011db47";

export const aksDocsRAGScenario = "Azure Kubernetes Service";

export const aksDocsRAGIntent = "RCH";

export const aksDocsRAGMessagePropmt = `
Generate a single powerful /bin/sh kubectl command based on the user request for interacting with Azure Kubernetes Service (AKS).
Make your best attempt to write the command as a single line command. If users do not provide sufficient context to craft the command, try your best to generate a command but with placeholders.
Do NOT use any other primary command other than kubectl. This means avoid using commands like pipe and grep. If no namespace is provided, default to all namespaces.
`