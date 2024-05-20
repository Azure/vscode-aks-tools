import { LanguageInfo, LanguageVersionInfo } from "../../webview-contract/webviewDefinitions/draft/types";

type LanguageInfoSource = {
    displayName: string;
    exampleVersions: string[];
    defaultPort?: number;
    versionDescription?: string;
    getDefaultBuilderImageTag?: (version: string) => string;
    getDefaultRuntimeImageTag: (version: string) => string;
};

type LanguageSourceLookup = Record<string, LanguageInfoSource>;

// TODO: Ideally this should be retrieved from the `draft info` command.
const supportedLanguages: LanguageSourceLookup = {
    javascript: {
        displayName: "JavaScript",
        exampleVersions: ["19", "18", "16", "14", "12", "10"],
        defaultPort: 3000,
        versionDescription: "Node.js version",
        getDefaultRuntimeImageTag: (version) => version,
    },
    go: {
        displayName: "Go",
        exampleVersions: ["1.20", "1.19", "1.18", "1.17", "1.16", "1.15"],
        defaultPort: 8080,
        getDefaultRuntimeImageTag: (version) => version,
    },
    python: {
        displayName: "Python",
        exampleVersions: ["3.11", "3.10", "3.9", "3.8", "3.7", "3.6"],
        defaultPort: 8000,
        getDefaultRuntimeImageTag: (version) => `${version}-slim`,
    },
    php: {
        displayName: "PHP",
        exampleVersions: ["8.2", "8.1", "8.0", "7.4", "7.3", "7.2", "7.1"],
        getDefaultBuilderImageTag: (version) => (parseInt(version.split(".")[0]) >= 8 ? "2.5" : "2.2"),
        getDefaultRuntimeImageTag: (version) => `${version}-apache`,
    },
    java: {
        displayName: "Java",
        exampleVersions: ["19", "17", "11", "8"],
        defaultPort: 8080,
        versionDescription: "Java version",
        getDefaultBuilderImageTag: (version) => `3-eclipse-temurin-${version}`,
        getDefaultRuntimeImageTag: (version) => `${version}-jre`,
    },
    csharp: {
        displayName: "C#",
        exampleVersions: ["7.0", "6.0", "5.0", "4.0", "3.1"],
        defaultPort: 5000,
        getDefaultRuntimeImageTag: (version) => version,
    },
    ruby: {
        displayName: "Ruby",
        exampleVersions: ["3.1.2", "3.1.3", "3.0.5", "2.7.7", "2.6", "2.5", "2.4"],
        defaultPort: 3000,
        getDefaultRuntimeImageTag: (version) => version,
    },
    rust: {
        displayName: "Rust",
        exampleVersions: ["1.70", "1.67", "1.66", "1.65", "1.64", "1.63", "1.62", "1.54", "1.53"],
        defaultPort: 8000,
        getDefaultRuntimeImageTag: (version) => `${version}-slim`,
    },
    swift: {
        displayName: "Swift",
        exampleVersions: ["5.7", "5.6", "5.5", "5.4", "5.3", "5.2", "5.1", "5.0", "4.2"],
        defaultPort: 8080,
        getDefaultRuntimeImageTag: (version) => `${version}-slim`,
    },
    clojure: {
        displayName: "Clojure",
        exampleVersions: ["19", "17", "11", "8"],
        defaultPort: 3000,
        versionDescription: "Java version",
        getDefaultRuntimeImageTag: (version) => `${version}-jdk-alpine`,
    },
    erlang: {
        displayName: "Erlang",
        exampleVersions: ["25.2", "24.3", "23.3", "22.3", "21.3", "20.3"],
        getDefaultBuilderImageTag: (version) => `${version}-alpine`,
        getDefaultRuntimeImageTag: () => "3.15",
    },
    gradle: {
        displayName: "Gradle",
        exampleVersions: ["19", "17", "11", "8"],
        defaultPort: 8080,
        versionDescription: "Java version",
        getDefaultBuilderImageTag: (version) => `jdk${version}`,
        getDefaultRuntimeImageTag: (version) => `${version}-jre`,
    },
    gradlew: {
        displayName: "Gradle Wrapper",
        exampleVersions: ["19", "17", "11", "8"],
        defaultPort: 8080,
        versionDescription: "Java version",
        getDefaultBuilderImageTag: (version) => `jdk${version}`,
        getDefaultRuntimeImageTag: (version) => `${version}-jre`,
    },
    gomodule: {
        displayName: "GoModule",
        exampleVersions: ["1.20", "1.19", "1.18", "1.17", "1.16", "1.15"],
        versionDescription: "Go version",
        getDefaultRuntimeImageTag: (version) => version,
    },
};

export function getSupportedLanguages(): LanguageInfo[] {
    return Object.keys(supportedLanguages).map<LanguageInfo>(getLanguageInfo);
}

export function getLanguageInfo(language: string): LanguageInfo {
    const source = supportedLanguages[language];
    return {
        name: language,
        displayName: source.displayName,
        defaultPort: source.defaultPort,
        exampleVersions: source.exampleVersions,
        versionDescription: source.versionDescription,
        isBuilderImageRequired: source.getDefaultBuilderImageTag !== undefined,
    };
}

export function getLanguageVersionInfo(language: string, version: string): LanguageVersionInfo {
    const source = supportedLanguages[language];
    return {
        builderImageTag: source.getDefaultBuilderImageTag?.(version),
        runtimeImageTag: source.getDefaultRuntimeImageTag(version),
    };
}
