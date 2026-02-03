/**
 * Fuzzing tests for Azure ARM ID parsing functions
 *
 * These property-based tests use fast-check to generate random inputs
 * and verify that parsing functions handle edge cases correctly.
 */

import * as fc from "fast-check";
import { expect } from "chai";
import { parseResource, parseSubId } from "../../azure-api-utils";

describe("Azure API Utils - Fuzz Tests", () => {
    describe("parseResource", () => {
        it("should not throw on arbitrary strings", () => {
            fc.assert(
                fc.property(fc.string(), (input) => {
                    // Should not throw regardless of input
                    try {
                        parseResource(input);
                        return true;
                    } catch (e) {
                        return false;
                    }
                }),
                { numRuns: 1000 },
            );
        });

        it("should handle path-like strings with slashes", () => {
            fc.assert(
                fc.property(
                    fc.array(fc.string({ minLength: 0, maxLength: 50 }), { minLength: 0, maxLength: 20 }),
                    (parts) => {
                        const input = "/" + parts.join("/");
                        try {
                            const result = parseResource(input);
                            // Result should always be an object with expected keys
                            expect(result).to.have.property("parentResourceId");
                            expect(result).to.have.property("subscriptionId");
                            expect(result).to.have.property("resourceGroupName");
                            expect(result).to.have.property("name");
                            return true;
                        } catch (e) {
                            return false;
                        }
                    },
                ),
                { numRuns: 500 },
            );
        });

        it("should handle valid Azure ARM IDs correctly", () => {
            const armIdArbitrary = fc
                .tuple(
                    fc.uuid(), // subscription ID
                    fc.stringMatching(/^[a-zA-Z0-9_-]{1,90}$/), // resource group name
                    fc.stringMatching(/^[a-zA-Z0-9_-]{1,63}$/), // resource name
                    fc.constantFrom("Microsoft.ContainerService", "Microsoft.Compute", "Microsoft.Storage"),
                )
                .map(
                    ([subId, rgName, resourceName, provider]) =>
                        `/subscriptions/${subId}/resourceGroups/${rgName}/providers/${provider}/managedClusters/${resourceName}`,
                );

            fc.assert(
                fc.property(armIdArbitrary, (armId) => {
                    const result = parseResource(armId);
                    // Should successfully parse valid ARM IDs
                    expect(result.subscriptionId).to.be.a("string");
                    expect(result.resourceGroupName).to.be.a("string");
                    expect(result.name).to.be.a("string");
                    return true;
                }),
                { numRuns: 200 },
            );
        });

        it("should handle empty and whitespace strings", () => {
            fc.assert(
                fc.property(fc.array(fc.constantFrom(" ", "\t", "\n", "\r", "")).map(arr => arr.join("")), (input) => {
                    try {
                        const result = parseResource(input);
                        expect(result).to.be.an("object");
                        return true;
                    } catch (e) {
                        return false;
                    }
                }),
                { numRuns: 100 },
            );
        });

        it("should handle strings with special characters", () => {
            fc.assert(
                fc.property(fc.string({ minLength: 0, maxLength: 200 }), (input) => {
                    try {
                        parseResource(input);
                        return true;
                    } catch (e) {
                        return false;
                    }
                }),
                { numRuns: 500 },
            );
        });

        it("should handle malformed ARM IDs gracefully", () => {
            const malformedArmId = fc.oneof(
                // Missing parts
                fc.constant("/subscriptions/"),
                fc.constant("/subscriptions/abc/resourceGroups/"),
                // Duplicate slashes
                fc.stringMatching(/\/\/+/),
                // Mixed case variations
                fc.string().map((s) => "/SUBSCRIPTIONS/" + s),
                // Invalid characters
                fc.string().map((s) => "/subscriptions/<script>" + s),
            );

            fc.assert(
                fc.property(malformedArmId, (input) => {
                    try {
                        const result = parseResource(input);
                        // Should return an object even if parsing is incomplete
                        expect(result).to.be.an("object");
                        return true;
                    } catch (e) {
                        return false;
                    }
                }),
                { numRuns: 200 },
            );
        });
    });

    describe("parseSubId", () => {
        it("should not throw on arbitrary strings", () => {
            fc.assert(
                fc.property(fc.string(), (input) => {
                    try {
                        parseSubId(input);
                        return true;
                    } catch (e) {
                        return false;
                    }
                }),
                { numRuns: 1000 },
            );
        });

        it("should extract subscription ID from valid ARM IDs", () => {
            const armIdArbitrary = fc
                .tuple(fc.uuid(), fc.string({ minLength: 1, maxLength: 100 }))
                .map(([subId, rest]) => `/subscriptions/${subId}/${rest}`);

            fc.assert(
                fc.property(armIdArbitrary, (armId) => {
                    const result = parseSubId(armId);
                    expect(result).to.have.property("subId");
                    expect(result.subId).to.be.a("string");
                    return true;
                }),
                { numRuns: 200 },
            );
        });

        it("should handle edge cases with few path segments", () => {
            fc.assert(
                fc.property(fc.array(fc.string({ maxLength: 20 }), { maxLength: 3 }), (parts) => {
                    const input = "/" + parts.join("/");
                    try {
                        const result = parseSubId(input);
                        expect(result).to.have.property("subId");
                        return true;
                    } catch (e) {
                        return false;
                    }
                }),
                { numRuns: 200 },
            );
        });
    });

    describe("Security - Injection Attacks", () => {
        it("should not be vulnerable to path traversal attacks", () => {
            const pathTraversalArbitrary = fc.oneof(
                fc.constant("../../../etc/passwd"),
                fc.constant("..\\..\\..\\windows\\system32"),
                fc.string().map((s) => `../../${s}`),
                fc.string().map((s) => `..\\.\\${s}`),
            );

            fc.assert(
                fc.property(pathTraversalArbitrary, (input) => {
                    const armId = `/subscriptions/${input}/resourceGroups/test`;
                    const result = parseResource(armId);
                    // Should parse without executing any path operations
                    expect(result).to.be.an("object");
                    return true;
                }),
                { numRuns: 100 },
            );
        });

        it("should handle potential XSS payloads safely", () => {
            const xssPayloads = fc.oneof(
                fc.constant("<script>alert(1)</script>"),
                fc.constant("javascript:alert(1)"),
                fc.constant("<img src=x onerror=alert(1)>"),
                fc.constant("xss-test-payload"),
            );

            fc.assert(
                fc.property(xssPayloads, (payload) => {
                    const armId = `/subscriptions/${payload}/resourceGroups/test/providers/Microsoft.Test/resources/name`;
                    const result = parseResource(armId);
                    // Should parse without throwing or executing any code
                    expect(result).to.be.an("object");
                    expect(result).to.have.property("subscriptionId");
                    expect(result).to.have.property("resourceGroupName");
                    expect(result).to.have.property("name");
                    // The important part: function doesn't throw and returns expected structure
                    // The actual parsing behavior may vary based on the payload
                    return true;
                }),
                { numRuns: 50 },
            );
        });
    });
});
