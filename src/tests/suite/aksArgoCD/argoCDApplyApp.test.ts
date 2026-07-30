import * as assert from "assert";
import { parseArgoCDPort } from "../../../commands/aksArgoCD/argoCDApplyApp";

describe("argoCDApplyApp — parseArgoCDPort", () => {
    it("parses a port from a full https URL", () => {
        assert.strictEqual(parseArgoCDPort("https://localhost:9000"), 9000);
    });

    it("parses a port from a full http URL", () => {
        assert.strictEqual(parseArgoCDPort("http://localhost:8081"), 8081);
    });

    it("parses a port from a bare host:port value (global.domain)", () => {
        assert.strictEqual(parseArgoCDPort("localhost:9000"), 9000);
    });

    it("parses a port from a real hostname with a port", () => {
        assert.strictEqual(parseArgoCDPort("argocd.example.com:8443"), 8443);
    });

    it("ignores a trailing path when extracting the port", () => {
        assert.strictEqual(parseArgoCDPort("https://localhost:9000/argocd"), 9000);
    });

    it("strips surrounding quotes (jsonpath output)", () => {
        assert.strictEqual(parseArgoCDPort('"https://localhost:9000"'), 9000);
    });

    it("returns undefined when there is no explicit port (URL)", () => {
        assert.strictEqual(parseArgoCDPort("https://localhost"), undefined);
    });

    it("returns undefined when there is no explicit port (bare host)", () => {
        assert.strictEqual(parseArgoCDPort("argocd.example.com"), undefined);
    });

    it("returns undefined for empty / undefined input", () => {
        assert.strictEqual(parseArgoCDPort(""), undefined);
        assert.strictEqual(parseArgoCDPort(undefined), undefined);
    });

    it("returns undefined for an out-of-range port", () => {
        assert.strictEqual(parseArgoCDPort("localhost:70000"), undefined);
        assert.strictEqual(parseArgoCDPort("localhost:0"), undefined);
    });
});
