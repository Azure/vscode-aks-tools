export type ForkData = {
    name: string;
    owner: string;
    repo: string;
    isFork: boolean;
    defaultBranch: string;
    branches: string[];
};

export function getAllForkData(): ForkData[] {
    return [
        {
            name: "upstream",
            owner: "Contoso",
            repo: "aks-store-demo",
            isFork: false,
            defaultBranch: "main",
            branches: ["main", "feature1", "feature2"],
        },
        {
            name: "origin",
            owner: "developer",
            repo: "aks-store-demo",
            isFork: true,
            defaultBranch: "main",
            branches: ["main", "feature1", "feature2"],
        },
        {
            name: "other-remote",
            owner: "otherdev",
            repo: "aks-store-demo",
            isFork: true,
            defaultBranch: "main",
            branches: ["main", "feature1", "feature2"],
        },
    ];
}
