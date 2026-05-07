export const KICKSTART_SAMPLE_REPO_URL = "https://github.com/Azure-Samples/aks-store-demo.git";
export const KICKSTART_PARTICIPANT_ID = "ms-kubernetes-tools.kickstart";
export const KICKSTART_PARTICIPANT_NAME = "kickstart";
export const KICKSTART_CONTENT_ID = "kickstart" as const;

export interface SampleRepo {
    label: string;
    description: string;
    url: string;
}

export const KICKSTART_SAMPLE_REPOS: SampleRepo[] = [
    {
        label: "AKS Store Demo",
        description: "Microservices app (Node.js + Python + Go + Rust)",
        url: "https://github.com/Azure-Samples/aks-store-demo.git",
    },
    {
        label: "Azure Voting App",
        description: "Simple two-container app (Python + Redis)",
        url: "https://github.com/Azure-Samples/azure-voting-app-redis.git",
    },
    {
        label: "Contoso Real Estate",
        description: "Full-stack JavaScript app (Next.js + Fastify + PostgreSQL)",
        url: "https://github.com/Azure-Samples/contoso-real-estate.git",
    },
];
