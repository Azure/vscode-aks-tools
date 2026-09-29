/**
 * Fuzzing tests for TCP Dump command parsing
 *
 * Tests command parsing functions to prevent command injection and
 * ensure robust handling of tcpdump commands and file paths.
 */

import * as fc from "fast-check";
import { expect } from "chai";
import {
    getCaptureFromCommand,
    getCaptureFromFilePath,
    getTcpDumpPodCommand,
    isValidCaptureIdentifier,
} from "../../panels/utilities/TcpDumpCommand";

const captureFilePrefix = "vscodenodecap_";
const tcpDumpCommandBase = "tcpdump --snapshot-length=0 -vvv";

describe("TCP Dump Command Parsing - Fuzz Tests", () => {
    describe("getCaptureFromCommand", () => {
        it("should not throw on arbitrary command inputs", () => {
            fc.assert(
                fc.property(fc.string(), fc.string(), (command, commandWithArgs) => {
                    try {
                        getCaptureFromCommand(command, commandWithArgs);
                        return true;
                    } catch {
                        return false;
                    }
                }),
                { numRuns: 1000 },
            );
        });

        it("should handle valid tcpdump commands correctly", () => {
            const validTcpDumpCmd = fc
                .tuple(
                    fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/),
                    fc.constantFrom("eth0", "eth1", "lo", "any"),
                )
                .map(
                    ([captureName, iface]) =>
                        `${tcpDumpCommandBase} -i ${iface} -w /tmp/${captureFilePrefix}${captureName}.cap`,
                );

            fc.assert(
                fc.property(validTcpDumpCmd, (cmd) => {
                    const result = getCaptureFromCommand("tcpdump", cmd);
                    expect(result).to.not.equal(null);
                    expect(isValidCaptureIdentifier(result!)).to.equal(true);
                    return true;
                }),
                { numRuns: 200 },
            );
        });

        it("should return null for non-tcpdump commands", () => {
            fc.assert(
                fc.property(
                    fc.string().filter((s) => s !== "tcpdump"),
                    fc.string(),
                    (command, args) => {
                        const result = getCaptureFromCommand(command, args);
                        expect(result).to.equal(null);
                        return true;
                    },
                ),
                { numRuns: 200 },
            );
        });
    });

    describe("getCaptureFromFilePath", () => {
        it("should not throw on arbitrary file paths", () => {
            fc.assert(
                fc.property(fc.string(), (filePath) => {
                    try {
                        getCaptureFromFilePath(filePath);
                        return true;
                    } catch {
                        return false;
                    }
                }),
                { numRuns: 1000 },
            );
        });

        it("should extract capture name from valid paths", () => {
            const validCapturePath = fc
                .stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/)
                .map((name) => `/tmp/${captureFilePrefix}${name}.cap`);

            fc.assert(
                fc.property(validCapturePath, (path) => {
                    const result = getCaptureFromFilePath(path);
                    expect(result).to.not.equal(null);
                    expect(isValidCaptureIdentifier(result!)).to.equal(true);
                    return true;
                }),
                { numRuns: 200 },
            );
        });

        it("should handle path traversal attempts", () => {
            const pathTraversalAttempts = fc.oneof(
                fc.constant("../../etc/passwd"),
                fc.constant("../../../tcpdump-test.cap"),
                fc.string().map((s) => `../${s}`),
                fc.string().map((s) => `../../${captureFilePrefix}${s}.cap`),
            );

            fc.assert(
                fc.property(pathTraversalAttempts, (path) => {
                    const result = getCaptureFromFilePath(path);
                    expect(result).to.equal(null);
                    return true;
                }),
                { numRuns: 100 },
            );
        });
    });

    describe("Security - Command Injection Prevention", () => {
        it("should safely handle command injection attempts in capture names", () => {
            const injectionPayloads = fc.oneof(
                fc.constant("test; rm -rf /"),
                fc.constant("test$(whoami)"),
                fc.constant("test`ls -la`"),
                fc.constant("test| cat /etc/passwd"),
                fc.constant("test&& malicious"),
                fc.constant("test\nrm -rf /"),
            );

            fc.assert(
                fc.property(injectionPayloads, (payload) => {
                    const cmd = `${tcpDumpCommandBase} -w /tmp/${captureFilePrefix}${payload}.cap`;
                    expect(getCaptureFromCommand("tcpdump", cmd)).to.equal(null);
                    return true;
                }),
                { numRuns: 100 },
            );
        });

        it("should handle shell metacharacters in file paths", () => {
            const shellMetachars = fc
                .string()
                .map((s) => s + fc.sample(fc.constantFrom(";", "|", "&", "$", "`", ">", "<", "\n", "\r"), 1)[0]);

            fc.assert(
                fc.property(shellMetachars, (metachars) => {
                    const path = `/tmp/tcpdump-test${metachars}.cap`;
                    const result = getCaptureFromFilePath(path);
                    expect(result).to.equal(null);
                    return true;
                }),
                { numRuns: 200 },
            );
        });

        it("should keep generated shell payloads out of the local shell command", () => {
            fc.assert(
                fc.property(
                    fc.string().filter((value) => !value.includes("\0")),
                    (value) => {
                        const filter = `$(printf '${value.replace(/'/g, "")}' >/tmp/pwned)`;
                        const command = getTcpDumpPodCommand("capture-1", {
                            interface: null,
                            pcapFilterString: filter,
                        });
                        expect(command).not.to.include(filter);
                        return true;
                    },
                ),
                { numRuns: 500 },
            );
        });
    });
});
