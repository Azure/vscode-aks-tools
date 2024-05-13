import { Errorable, combine, failed } from "./errorable";
import { DeploymentSpecType } from "../../webview-contract/webviewDefinitions/draft/types";
import path from "path";
import { ShellOptions, exec } from "./shell";
import { parseJson } from "./json";
import { dirSync } from "tmp";

type DryRunOutput = {
    variables: { [variableName: string]: string };
    filesToWrite: string[];
};

export type DeploymentFiles = {
    [T in DeploymentSpecType]: string[];
};

export async function getDeploymentFilesToWrite(draftBinaryPath: string): Promise<Errorable<DeploymentFiles>> {
    const destDir = dirSync();
    const deploymentTypes: DeploymentSpecType[] = ["helm", "kustomize", "manifests"];
    const filesResults = await Promise.all(
        deploymentTypes.map((deploymentType) => getDeploymentFiles(draftBinaryPath, deploymentType, destDir.name)),
    );
    const filesResult = combine(filesResults);
    if (failed(filesResult)) {
        return filesResult;
    }

    const [helmFiles, kustomizeFiles, manifestsFiles] = filesResult.result;
    const result: DeploymentFiles = {
        helm: helmFiles,
        kustomize: kustomizeFiles,
        manifests: manifestsFiles,
    };

    return { succeeded: true, result };
}

async function getDeploymentFiles(
    draftBinaryPath: string,
    deploymentType: DeploymentSpecType,
    destDir: string,
): Promise<Errorable<string[]>> {
    // To get the files that would be written by `draft create`, we need to run `draft create` with the `--dry-run` flag.
    // The files that will be created do not depend on the actual values of the variables, so we can use dummy values here:
    const variables = {
        APPNAME: "dummyapp",
        IMAGENAME: "dummyimage",
        IMAGETAG: "latest",
        NAMESPACE: "dummyns",
        PORT: 80,
        SERVICEPORT: 80,
    };

    const variableArgs = Object.entries(variables)
        .map(([key, value]) => `--variable ${key}=${value}`)
        .join(" ");

    const language = "java"; // So it doesn't attempt to autodetect the language
    const command = `draft create --language ${language} --deployment-only --deploy-type ${deploymentType} --app testapp ${variableArgs} --destination ${destDir} --dry-run --silent`;

    const execOptions: ShellOptions = {
        envPaths: [path.dirname(draftBinaryPath)],
    };

    const shellResult = await exec(command, execOptions);
    if (failed(shellResult)) {
        return shellResult;
    }

    const output = parseJson<DryRunOutput>(shellResult.result.stdout);
    if (failed(output)) {
        return output;
    }

    const result = output.result.filesToWrite.map((file) => file.substring(destDir.length + 1));
    return { succeeded: true, result };
}
