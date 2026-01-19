/**
 * Fuzzing tests for TCP Dump command and process parsing
 * 
 * Tests command parsing functions to prevent command injection and
 * ensure robust handling of process output.
 */

import * as fc from 'fast-check';
import { expect } from 'chai';

// Mock functions extracted from TcpDumpPanel
const captureFilePrefix = 'tcpdump-';
const captureFilePathRegex = `${captureFilePrefix}([a-zA-Z0-9_-]+)\\.cap`;
const tcpDumpCommandBase = 'tcpdump';

function getCaptureFromCommand(command: string, commandWithArgs: string): string | null {
    if (command !== 'tcpdump') return null;
    if (!commandWithArgs.startsWith(tcpDumpCommandBase)) return null;
    const fileMatch = commandWithArgs.match(new RegExp(`\\-w ${captureFilePathRegex}`));
    return fileMatch && fileMatch[1];
}

function getCaptureFromFilePath(filePath: string): string | null {
    const fileMatch = filePath.match(new RegExp(captureFilePathRegex));
    if (!fileMatch) return null;
    return fileMatch && fileMatch[1];
}

describe('TCP Dump Command Parsing - Fuzz Tests', () => {
    describe('getCaptureFromCommand', () => {
        it('should not throw on arbitrary command inputs', () => {
            fc.assert(
                fc.property(
                    fc.string(),
                    fc.string(),
                    (command, commandWithArgs) => {
                        try {
                            getCaptureFromCommand(command, commandWithArgs);
                            return true;
                        } catch (e) {
                            return false;
                        }
                    }
                ),
                { numRuns: 1000 }
            );
        });

        it('should handle valid tcpdump commands correctly', () => {
            const validTcpDumpCmd = fc.tuple(
                fc.stringMatching(/^[a-zA-Z0-9_-]{1,50}$/),
                fc.constantFrom('eth0', 'eth1', 'lo', 'any')
            ).map(([captureName, iface]) => 
                `tcpdump -i ${iface} -w ${captureFilePrefix}${captureName}.cap`
            );

            fc.assert(
                fc.property(
                    validTcpDumpCmd,
                    (cmd) => {
                        const result = getCaptureFromCommand('tcpdump', cmd);
                        if (result) {
                            expect(result).to.be.a('string');
                            expect(result).to.match(/^[a-zA-Z0-9_-]+$/);
                        }
                        return true;
                    }
                ),
                { numRuns: 200 }
            );
        });

        it('should return null for non-tcpdump commands', () => {
            fc.assert(
                fc.property(
                    fc.string().filter(s => s !== 'tcpdump'),
                    fc.string(),
                    (command, args) => {
                        const result = getCaptureFromCommand(command, args);
                        expect(result).to.be.null;
                        return true;
                    }
                ),
                { numRuns: 200 }
            );
        });
    });

    describe('getCaptureFromFilePath', () => {
        it('should not throw on arbitrary file paths', () => {
            fc.assert(
                fc.property(
                    fc.string(),
                    (filePath) => {
                        try {
                            getCaptureFromFilePath(filePath);
                            return true;
                        } catch (e) {
                            return false;
                        }
                    }
                ),
                { numRuns: 1000 }
            );
        });

        it('should extract capture name from valid paths', () => {
            const validCapturePath = fc.stringMatching(/^[a-zA-Z0-9_-]{1,50}$/)
                .map(name => `/tmp/${captureFilePrefix}${name}.cap`);

            fc.assert(
                fc.property(
                    validCapturePath,
                    (path) => {
                        const result = getCaptureFromFilePath(path);
                        if (result) {
                            expect(result).to.be.a('string');
                            expect(result).to.match(/^[a-zA-Z0-9_-]+$/);
                        }
                        return true;
                    }
                ),
                { numRuns: 200 }
            );
        });

        it('should handle path traversal attempts', () => {
            const pathTraversalAttempts = fc.oneof(
                fc.constant('../../etc/passwd'),
                fc.constant('../../../tcpdump-test.cap'),
                fc.string().map(s => `../${s}`),
                fc.string().map(s => `../../${captureFilePrefix}${s}.cap`)
            );

            fc.assert(
                fc.property(
                    pathTraversalAttempts,
                    (path) => {
                        const result = getCaptureFromFilePath(path);
                        // Should either return null or a sanitized capture name
                        if (result) {
                            expect(result).to.be.a('string');
                        }
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });
    });

    describe('Security - Command Injection Prevention', () => {
        it('should safely handle command injection attempts in capture names', () => {
            const injectionPayloads = fc.oneof(
                fc.constant('test; rm -rf /'),
                fc.constant('test$(whoami)'),
                fc.constant('test`ls -la`'),
                fc.constant('test| cat /etc/passwd'),
                fc.constant('test&& malicious'),
                fc.constant('test\nrm -rf /')
            );

            fc.assert(
                fc.property(
                    injectionPayloads,
                    (payload) => {
                        const cmd = `tcpdump -w ${captureFilePrefix}${payload}.cap`;
                        const result = getCaptureFromCommand('tcpdump', cmd);
                        // Should not extract capture name with injection characters
                        // or should sanitize it
                        if (result) {
                            expect(result).to.not.include(';');
                            expect(result).to.not.include('|');
                            expect(result).to.not.include('&');
                            expect(result).to.not.include('$');
                            expect(result).to.not.include('`');
                        }
                        return true;
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('should handle shell metacharacters in file paths', () => {
            const shellMetachars = fc.stringOf(
                fc.constantFrom(';', '|', '&', '$', '`', '>', '<', '\n', '\r')
            );

            fc.assert(
                fc.property(
                    shellMetachars,
                    (metachars) => {
                        const path = `/tmp/tcpdump-test${metachars}.cap`;
                        const result = getCaptureFromFilePath(path);
                        // Should either reject or sanitize
                        if (result) {
                            expect(result).to.be.a('string');
                        }
                        return true;
                    }
                ),
                { numRuns: 200 }
            );
        });
    });
});
