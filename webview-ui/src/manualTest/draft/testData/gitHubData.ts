export type GitHubRepoData = {
    forkName: string;
    ownerName: string;
    repoName: string;
    isFork: boolean;
    defaultBranch: string;
    branches: string[];
};

export function getGitHubRepoData(): GitHubRepoData[] {
    return [
        {
            forkName: "upstream",
            ownerName: "Contoso",
            repoName: "aks-store-demo",
            isFork: false,
            defaultBranch: "main",
            branches: ["main", "feature1", "feature2"],
        },
        {
            forkName: "origin",
            ownerName: "developer",
            repoName: "aks-store-demo",
            isFork: true,
            defaultBranch: "main",
            branches: ["main", "feature1", "feature2"],
        },
        {
            forkName: "other-remote",
            ownerName: "otherdev",
            repoName: "aks-store-demo",
            isFork: true,
            defaultBranch: "main",
            branches: ["main", "feature1", "feature2"],
        },
    ];
}
