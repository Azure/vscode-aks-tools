import { LanguageInfo, LanguageVersionInfo } from "../../../src/webview-contract/webviewDefinitions/draft/types";

export function getSupportedLanguages(): LanguageInfo[] {
    return Object.entries(supportedLanguages).map((e) => asLanguageInfo(e[0], e[1]));
}

function asLanguageInfo(name: string, versionLookup: LanguageVersionLookup): LanguageInfo {
    const versions: LanguageVersionInfo[] = Object.entries(versionLookup).map((e) => asVersionInfo(e[0], e[1]));
    const displayName = languagesMap[name].displayValue;
    const defaultPort = parseInt(defaultPortsMap[name] || "80");
    return { name, displayName, defaultPort, versions };
}

function asVersionInfo(name: string, detail: LanguageVersionDetail): LanguageVersionInfo {
    return { name, ...detail };
}

type SupportedLanguageLookup = {
    [name: string]: LanguageVersionLookup;
};

type LanguageVersionLookup = {
    [version: string]: LanguageVersionDetail;
};

type LanguageVersionDetail = {
    imageVersion: string;
    builderVersion: string;
};

// From Azure Portal. These need to be hard-coded for now, but ideally would be fetched from an API.
// Draft itself provides an `info` command that _nearly_ achieves this, but is structured in a way
// that makes it hard to extract clean names for languages/versions, as well as missing several values
// which are available in the Portal.
const supportedLanguages: SupportedLanguageLookup = {
    clojure: {
        "Java 17": {
            imageVersion: "17-jdk-alpine",
            builderVersion: "",
        },
        "Java 11": {
            imageVersion: "11-jdk-alpine",
            builderVersion: "",
        },
        "Java 8": {
            imageVersion: "8-jdk-alpine",
            builderVersion: "",
        },
    },
    csharp: {
        "7.0": {
            imageVersion: "7.0",
            builderVersion: "",
        },
        "6.0": {
            imageVersion: "6.0",
            builderVersion: "",
        },
        "5.0": {
            imageVersion: "5.0",
            builderVersion: "",
        },
        "4.0": {
            imageVersion: "4.0",
            builderVersion: "",
        },
        "3.1": {
            imageVersion: "3.1",
            builderVersion: "",
        },
    },
    erlang: {
        "25": {
            imageVersion: "3.15",
            builderVersion: "25.2-alpine",
        },
        "24": {
            imageVersion: "3.15",
            builderVersion: "24.3-alpine",
        },
        "23": {
            imageVersion: "3.15",
            builderVersion: "23.3-alpine",
        },
        "22": {
            imageVersion: "3.15",
            builderVersion: "22.3-alpine",
        },
        "21": {
            imageVersion: "3.15",
            builderVersion: "21.3",
        },
        "20": {
            imageVersion: "3.15",
            builderVersion: "20.3",
        },
    },
    go: {
        "1.20": {
            imageVersion: "1.20",
            builderVersion: "",
        },
        "1.19": {
            imageVersion: "1.19",
            builderVersion: "",
        },
        "1.18": {
            imageVersion: "1.18",
            builderVersion: "",
        },
        "1.17": {
            imageVersion: "1.17",
            builderVersion: "",
        },
        "1.16": {
            imageVersion: "1.16",
            builderVersion: "",
        },
        "1.15": {
            imageVersion: "1.15",
            builderVersion: "",
        },
    },
    gomodule: {
        "1.20": {
            imageVersion: "1.20",
            builderVersion: "",
        },
        "1.19": {
            imageVersion: "1.19",
            builderVersion: "",
        },
        "1.18": {
            imageVersion: "1.18",
            builderVersion: "",
        },
        "1.17": {
            imageVersion: "1.17",
            builderVersion: "",
        },
        "1.16": {
            imageVersion: "1.16",
            builderVersion: "",
        },
        "1.15": {
            imageVersion: "1.15",
            builderVersion: "",
        },
    },
    gradle: {
        "Java 19": {
            imageVersion: "19-jdk",
            builderVersion: "jdk19",
        },
        "Java 17": {
            imageVersion: "17-jdk",
            builderVersion: "jdk17",
        },
        "Java 11": {
            imageVersion: "11-jre-slim",
            builderVersion: "jdk11",
        },
        "Java 8": {
            imageVersion: "8-jre-slim",
            builderVersion: "jdk8",
        },
    },
    java: {
        "Java 8": {
            imageVersion: "8-jre",
            builderVersion: "3-eclipse-temurin-8",
        },
        "Java 11": {
            imageVersion: "11-jre",
            builderVersion: "3-eclipse-temurin-11",
        },
        "Java 17": {
            imageVersion: "17-jre",
            builderVersion: "3-eclipse-temurin-17",
        },
        "Java 19": {
            imageVersion: "19-jre",
            builderVersion: "3-eclipse-temurin-19",
        },
    },
    javascript: {
        "Node.js 19": {
            imageVersion: "19",
            builderVersion: "",
        },
        "Node.js 18": {
            imageVersion: "18",
            builderVersion: "",
        },
        "Node.js 16": {
            imageVersion: "16",
            builderVersion: "",
        },
        "Node.js 14": {
            imageVersion: "14",
            builderVersion: "",
        },
        "Node.js 10": {
            imageVersion: "10",
            builderVersion: "",
        },
    },
    php: {
        "8.2": {
            imageVersion: "8.2-apache",
            builderVersion: "2.5",
        },
        "8.1": {
            imageVersion: "8.1-apache",
            builderVersion: "2.5",
        },
        "8.0": {
            imageVersion: "8.0-apache",
            builderVersion: "2.5",
        },
        "7.4": {
            imageVersion: "7.4-apache",
            builderVersion: "2.2",
        },
        "7.3": {
            imageVersion: "7.3-apache",
            builderVersion: "2.2",
        },
        "7.2": {
            imageVersion: "7.2-apache",
            builderVersion: "2.2",
        },
        "7.1": {
            imageVersion: "7.1-apache",
            builderVersion: "2.2",
        },
    },
    python: {
        "3.11": {
            imageVersion: "3.11-slim",
            builderVersion: "",
        },
        "3.10": {
            imageVersion: "3.10-slim",
            builderVersion: "",
        },
        "3.9": {
            imageVersion: "3.9-slim",
            builderVersion: "",
        },
        "3.8": {
            imageVersion: "3.8-slim",
            builderVersion: "",
        },
        "3.7": {
            imageVersion: "3.7-slim",
            builderVersion: "",
        },
    },
    ruby: {
        "3.2": {
            imageVersion: "3.1.2",
            builderVersion: "",
        },
        "3.1": {
            imageVersion: "3.1.3",
            builderVersion: "",
        },
        "3.0": {
            imageVersion: "3.0.5",
            builderVersion: "",
        },
        "2.7": {
            imageVersion: "2.7.7",
            builderVersion: "",
        },
    },
    rust: {
        "1.67": {
            imageVersion: "1.67-slim",
            builderVersion: "",
        },
        "1.66": {
            imageVersion: "1.66-slim",
            builderVersion: "",
        },
        "1.65": {
            imageVersion: "1.65-slim",
            builderVersion: "",
        },
        "1.64": {
            imageVersion: "1.64-slim",
            builderVersion: "",
        },
        "1.63": {
            imageVersion: "1.63-slim",
            builderVersion: "",
        },
        "1.62": {
            imageVersion: "1.62-slim",
            builderVersion: "",
        },
    },
    swift: {
        "5.7": {
            imageVersion: "5.7-slim",
            builderVersion: "",
        },
        "5.6": {
            imageVersion: "5.6-slim",
            builderVersion: "",
        },
        "5.5": {
            imageVersion: "5.5-slim",
            builderVersion: "",
        },
        "5.4": {
            imageVersion: "5.4-slim",
            builderVersion: "",
        },
        "5.3": {
            imageVersion: "5.3-slim",
            builderVersion: "",
        },
        "5.2": {
            imageVersion: "5.2-slim",
            builderVersion: "",
        },
        "5.1": {
            imageVersion: "5.1-slim",
            builderVersion: "",
        },
        "5.0": {
            imageVersion: "5.0-slim",
            builderVersion: "",
        },
        "4.2": {
            imageVersion: "4.2",
            builderVersion: "",
        },
    },
};

export const enum GenerationLanguage {
    Clojure = "clojure",
    CSharp = "csharp",
    Erlang = "erlang",
    Go = "go",
    Gomodule = "gomodule",
    Gradle = "gradle",
    Java = "java",
    Javascript = "javascript",
    Php = "php",
    Python = "python",
    Ruby = "ruby",
    Rust = "rust",
    Swift = "swift",
}

type LanguageMap = {
    [key: string]: Language;
};

interface Language {
    name: GenerationLanguage;
    displayValue: string;
}

type PortMap = {
    [key: string]: string;
};

const languagesMap: LanguageMap = {
    javascript: {
        name: GenerationLanguage.Javascript,
        displayValue: "JavaScript",
    },
    go: {
        name: GenerationLanguage.Go,
        displayValue: "Go",
    },
    python: {
        name: GenerationLanguage.Python,
        displayValue: "Python",
    },
    php: {
        name: GenerationLanguage.Php,
        displayValue: "PHP",
    },
    java: {
        name: GenerationLanguage.Java,
        displayValue: "Java",
    },
    csharp: {
        name: GenerationLanguage.CSharp,
        displayValue: "C#",
    },
    ruby: {
        name: GenerationLanguage.Ruby,
        displayValue: "Ruby",
    },
    rust: {
        name: GenerationLanguage.Rust,
        displayValue: "Rust",
    },
    swift: {
        name: GenerationLanguage.Swift,
        displayValue: "Swift",
    },
    clojure: {
        name: GenerationLanguage.Clojure,
        displayValue: "Clojure",
    },
    erlang: {
        name: GenerationLanguage.Erlang,
        displayValue: "Erlang",
    },
    gradle: {
        name: GenerationLanguage.Gradle,
        displayValue: "Gradle",
    },
    gomodule: {
        name: GenerationLanguage.Gomodule,
        displayValue: "GoModule",
    },
};

const defaultPortsMap: PortMap = {
    javascript: "3000",
    java: "8080",
    csharp: "5000",
    ruby: "3000",
    rust: "8000",
    swift: "8080",
    clojure: "3000",
    gradle: "8080",
    go: "8080",
    python: "8000",
};
