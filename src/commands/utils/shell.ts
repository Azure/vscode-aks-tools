import { Errorable, getErrorMessage } from "./errorable";
import * as child from "child_process";
import { resolve } from "path";

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
    silent?: boolean;
}

export enum NonZeroExitCodeBehaviour {
    Succeed,
    Fail,
}

export async function exec(cmd: string, options?: ShellOptions): Promise<Errorable<ShellResult>> {
    try {
        const result = await execCore(cmd, options || {});
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

function execCore(cmd: string, shellOptions: ShellOptions): Promise<ShellResult> {
    const options = getExecOpts(shellOptions?.workingDir || null, shellOptions?.envPaths || []);

    return new Promise<ShellResult>((resolve) => {
        const c = child.exec(cmd, options, function (err, stdout, stderr) {
            if (!err) {
                resolve({ code: 0, stdout, stderr });
            } else if (err.code === undefined) {
                resolve({ code: 1, stdout, stderr });
            } else {
                resolve({ code: err.code, stdout, stderr });
            }
        });

        // Default to 'true' for silent.
        const silent = shellOptions.silent === undefined ? true : shellOptions.silent;
        if (!silent) {
            c.stdout?.pipe(process.stdout);
            c.stderr?.pipe(process.stderr);
        }

        if (shellOptions.stdin) {
            c.stdin?.end(shellOptions.stdin);
        }
    });
}

function getExecOpts(cwd: string | null, envPaths: string[]): child.ExecOptions {
    const maxBuffer = 20 * 1024 * 1024; // Taken from shelljs

    let env = process.env;
    if (isWindows()) {
        env = { ...env, HOME: home() };
    }
    env = addEnvPaths(env, envPaths || []);

    return {
        cwd: cwd || resolve(process.cwd()),
        env,
        maxBuffer,
    };
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
