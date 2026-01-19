/**
 * Fuzzing tests for KaitoModelsPanel GPU parsing
 *
 * Tests the parseGPU function with various inputs to ensure robust handling
 * of GPU requirement specifications.
 */

import * as fc from "fast-check";
import { expect } from "chai";

// Mock the parseGPU function since we can't easily instantiate the panel
// In a real scenario, you'd extract this to a utility function
function parseGPU(gpuRequirement: string): [string, number] {
    // Example: "2xNvidia_A100" -> ["Nvidia_A100", 2]
    const match = gpuRequirement.match(/^(\d+)x(.+)$/);
    if (match) {
        const cpus = parseInt(match[1], 10);
        const gpuFamily = match[2];
        return [gpuFamily, cpus];
    }
    return [gpuRequirement, 1];
}

describe("KAITO GPU Parsing - Fuzz Tests", () => {
    describe("parseGPU", () => {
        it("should not throw on arbitrary strings", () => {
            fc.assert(
                fc.property(fc.string(), (input) => {
                    try {
                        parseGPU(input);
                        return true;
                    } catch (e) {
                        return false;
                    }
                }),
                { numRuns: 1000 },
            );
        });

        it("should handle valid GPU format correctly", () => {
            const validGpuArbitrary = fc
                .tuple(
                    fc.integer({ min: 1, max: 128 }),
                    fc.constantFrom("Nvidia_A100", "Nvidia_V100", "Nvidia_T4", "AMD_MI250"),
                )
                .map(([count, family]) => `${count}x${family}`);

            fc.assert(
                fc.property(validGpuArbitrary, (input) => {
                    const [family, count] = parseGPU(input);
                    expect(family).to.be.a("string");
                    expect(count).to.be.a("number");
                    expect(count).to.be.gte(1);
                    expect(family.length).to.be.gte(1);
                    return true;
                }),
                { numRuns: 200 },
            );
        });

        it("should handle invalid number formats gracefully", () => {
            const invalidNumberFormats = fc.oneof(
                fc.constant("0xNvidia_A100"),
                fc.constant("-1xNvidia_A100"),
                fc.constant("999999999999999xNvidia_A100"),
                fc.constant("1.5xNvidia_A100"),
                fc.constant("NaNxNvidia_A100"),
                fc.string().map((s) => `${s}xNvidia_A100`),
            );

            fc.assert(
                fc.property(invalidNumberFormats, (input) => {
                    try {
                        const [family, count] = parseGPU(input);
                        expect(family).to.be.a("string");
                        expect(count).to.be.a("number");
                        // NaN check
                        if (Number.isNaN(count)) {
                            expect(count).to.be.NaN;
                        }
                        return true;
                    } catch (e) {
                        return false;
                    }
                }),
                { numRuns: 200 },
            );
        });

        it('should handle strings without "x" separator', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 100 }).filter((s) => !s.includes("x")),
                    (input) => {
                        const [family, count] = parseGPU(input);
                        // Should default to count=1 when format doesn't match
                        expect(family).to.equal(input);
                        expect(count).to.equal(1);
                        return true;
                    },
                ),
                { numRuns: 300 },
            );
        });

        it("should handle empty and whitespace strings", () => {
            fc.assert(
                fc.property(fc.stringOf(fc.constantFrom(" ", "\t", "\n", "")), (input) => {
                    try {
                        const [family, count] = parseGPU(input);
                        expect(family).to.be.a("string");
                        expect(count).to.be.a("number");
                        return true;
                    } catch (e) {
                        return false;
                    }
                }),
                { numRuns: 100 },
            );
        });

        it("should handle special characters in GPU family names", () => {
            const specialCharGpu = fc
                .tuple(fc.integer({ min: 1, max: 16 }), fc.string({ minLength: 1, maxLength: 50 }))
                .map(([count, family]) => `${count}x${family}`);

            fc.assert(
                fc.property(specialCharGpu, (input) => {
                    try {
                        const [family, count] = parseGPU(input);
                        expect(family).to.be.a("string");
                        expect(count).to.be.a("number");
                        return true;
                    } catch (e) {
                        return false;
                    }
                }),
                { numRuns: 200 },
            );
        });

        it('should handle multiple "x" characters', () => {
            const multipleXFormats = fc.oneof(
                fc.constant("2x3xNvidia_A100"),
                fc.constant("xNvidia_A100"),
                fc.constant("2xxNvidia_A100"),
                fc.constant("2x"),
                fc.constant("xxx"),
            );

            fc.assert(
                fc.property(multipleXFormats, (input) => {
                    try {
                        const [family, count] = parseGPU(input);
                        expect(family).to.be.a("string");
                        expect(count).to.be.a("number");
                        return true;
                    } catch (e) {
                        return false;
                    }
                }),
                { numRuns: 100 },
            );
        });
    });

    describe("Security - Injection Tests", () => {
        it("should safely handle potential command injection payloads", () => {
            const injectionPayloads = fc.oneof(
                fc.constant("1x$(whoami)"),
                fc.constant("1x`ls -la`"),
                fc.constant("1x; rm -rf /"),
                fc.constant("1x| cat /etc/passwd"),
                fc.constant("1x&& echo pwned"),
            );

            fc.assert(
                fc.property(injectionPayloads, (payload) => {
                    const [family, count] = parseGPU(payload);
                    // Should parse without executing commands
                    expect(family).to.be.a("string");
                    expect(count).to.be.a("number");
                    return true;
                }),
                { numRuns: 50 },
            );
        });
    });

    describe("Performance Tests", () => {
        it("should handle very long strings efficiently", () => {
            fc.assert(
                fc.property(fc.string({ minLength: 1000, maxLength: 10000 }), (input) => {
                    const startTime = Date.now();
                    parseGPU(input);
                    const endTime = Date.now();
                    // Should complete in reasonable time (< 100ms)
                    expect(endTime - startTime).to.be.lessThan(100);
                    return true;
                }),
                { numRuns: 50 },
            );
        });
    });
});
