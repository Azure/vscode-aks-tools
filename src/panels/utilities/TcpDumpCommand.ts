import type { CaptureFilters } from "../../webview-contract/webviewDefinitions/tcpDump";

const tcpDumpCommandBase = "tcpdump --snapshot-length=0 -vvv";
const captureFileBasePath = "/tmp/vscodenodecap_";
const captureIdentifierPattern = "[A-Za-z0-9][A-Za-z0-9_-]{0,127}";
const captureFilePathRegex = `${escapeRegExp(captureFileBasePath)}(${captureIdentifierPattern})\\.cap`;

export function escapeRegExp(input: string): string {
    return input.replace(/(\\)?([.*+?^${}()|[\]\\/])/g, (match, backslash, char) => {
        return backslash ? match : `\\${char}`;
    });
}

export function isValidCaptureIdentifier(value: string): boolean {
    return new RegExp(`^${captureIdentifierPattern}$`).test(value);
}

function quotePosixShellArg(value: string): string {
    if (value.includes("\0")) {
        throw new Error("Shell arguments cannot contain NUL.");
    }
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Returns the argument array to exec in the debug pod. The pod's shell is still needed to
 * background tcpdump, so the values are quoted for that shell. No local shell is involved:
 * the script reaches the pod as a single argument.
 */
export function getTcpDumpPodCommand(capture: string, filters: CaptureFilters): string[] {
    const parts = [
        tcpDumpCommandBase,
        filters.interface ? `-i ${quotePosixShellArg(filters.interface)}` : "",
        `-w ${quotePosixShellArg(`${captureFileBasePath}${capture}.cap`)}`,
        filters.pcapFilterString ? quotePosixShellArg(filters.pcapFilterString) : "",
    ].filter((part) => !!part);
    return ["/bin/sh", "-c", `${parts.join(" ")} 1>/dev/null 2>&1 &`];
}

export function getCaptureFromCommand(command: string, commandWithArgs: string): string | null {
    if (command !== "tcpdump" || !commandWithArgs.startsWith(tcpDumpCommandBase)) return null;
    const match = commandWithArgs.match(new RegExp(`\\-w ['"]?${captureFilePathRegex}['"]?(?=\\s|$)`));
    return match?.[1] ?? null;
}

export function getCaptureFromFilePath(filePath: string): string | null {
    return filePath.match(new RegExp(`^${captureFilePathRegex}$`))?.[1] ?? null;
}
