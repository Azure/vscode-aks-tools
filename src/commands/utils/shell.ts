import * as shelljs from "shelljs";
import { Errorable, getErrorMessage } from "./errorable";

export interface ShellResult {
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}

export interface ShellOptions {
    stdin?: string;
    envPaths?: string[];
    workingDir?: string;
    exitCodeBehaviour?: NonZeroExitCodeBehaviour;
}

export enum NonZeroExitCodeBehaviour {
    Succeed,
    Fail,
}

export async function exec(cmd: string, options?: ShellOptions): Promise<Errorable<ShellResult>> {
    try {
        const result = await execCore(
            cmd,
            getExecOpts(options?.workingDir || null, options?.envPaths || []),
            options?.stdin || null,
        );
        const exitCodeBehaviour = options?.exitCodeBehaviour ?? NonZeroExitCodeBehaviour.Fail;
        const succeeded = result.code === 0 || exitCodeBehaviour === NonZeroExitCodeBehaviour.Succeed;
        if (succeeded) {
            return { succeeded, result };
        } else {
            return {
                succeeded,
                error: `Command "${cmd}" failed with exit code ${result.code}.\nStdout:\n${result.stdout}\nStderr:\n${result.stderr}`,
            };
        }
    } catch (ex) {
        return { succeeded: false, error: getErrorMessage(ex) };
    }
}

function execCore(cmd: string, opts: shelljs.ExecOptions, stdin: string | null): Promise<ShellResult> {
    return new Promise<ShellResult>((resolve) => {
        opts["silent"] = true;
        const proc = shelljs.exec(cmd, opts, (code, stdout, stderr) =>
            resolve({ code: code, stdout: stdout, stderr: stderr }),
        );
        if (stdin) {
            proc.stdin?.end(stdin);
        }
    });
}

function getExecOpts(cwd: string | null, envPaths: string[]): shelljs.ExecOptions {
    let env = process.env;
    if (isWindows()) {
        env = { ...env, HOME: home() };
    }
    env = addEnvPaths(env, envPaths || []);
    return { cwd: cwd || undefined, env, async: true };
}

function isWindows(): boolean {
    return process.platform === "win32";
}

function home(): string {
    return (
        process.env["HOME"] ||
        concatIfSafe(process.env["HOMEDRIVE"], process.env["HOMEPATH"]) ||
        process.env["USERPROFILE"] ||
        ""
    );
}

function concatIfSafe(homeDrive: string | undefined, homePath: string | undefined): string | undefined {
    if (homeDrive && homePath) {
        const safe = !homePath.toLowerCase().startsWith("\\windows\\system32");
        if (safe) {
            return homeDrive.concat(homePath);
        }
    }

    return undefined;
}

export function addEnvPaths(baseEnvironment: NodeJS.ProcessEnv, envPaths: string[]): NodeJS.ProcessEnv {
    const env = Object.assign({}, baseEnvironment);
    const pathVariable = pathVariableName(env);
    if (envPaths.length > 0) {
        const separator = pathEntrySeparator();
        env[pathVariable] = envPaths.join(separator) + separator + env[pathVariable];
    }

    return env;
}

function pathVariableName(env: NodeJS.ProcessEnv): string {
    if (isWindows()) {
        for (const v of Object.keys(env)) {
            if (v.toLowerCase() === "path") {
                return v;
            }
        }
    }
    return "PATH";
}

function pathEntrySeparator() {
    return isWindows() ? ";" : ":";
}
