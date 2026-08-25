"use strict";

/**
 * Unit tests for the line-level parsers in scripts/docs-check.js.
 *
 * These run on plain node with no compile step:
 *   npm run test:scripts
 *
 * Requiring the module does not execute the checks, so no book on disk is
 * needed — each case is a single line of markdown.
 */

const assert = require("node:assert/strict");

const { crumbsIn, proseNavIn, withoutFencedCode, withoutUrls } = require("./docs-check");

describe("crumbsIn", () => {
    it("reads a chain anchored to a right-click", () => {
        const line = "Right-click your AKS cluster > **Manage Cluster** > **Delete Cluster**";
        assert.deepEqual(crumbsIn(line), [{ crumb: "**Manage Cluster** > **Delete Cluster**", root: "cluster" }]);
    });

    it("reads a single bold segment when a right-click anchors it", () => {
        const line = "Right-click your subscription > **Create Cluster**";
        assert.deepEqual(crumbsIn(line), [{ crumb: "**Create Cluster**", root: "subscription" }]);
    });

    it("takes the node from the lead-in only", () => {
        // scanning the whole line resolved this to the fleet node and failed a
        // correct page
        const line = "Right-click your AKS cluster > **Manage Cluster**. This removes the fleet member too.";
        assert.deepEqual(crumbsIn(line), [{ crumb: "**Manage Cluster**", root: "cluster" }]);
    });

    it("returns nothing for a line with no bold", () => {
        assert.deepEqual(crumbsIn("Right-click your AKS cluster and pick an action."), []);
    });

    // the gap the menu-syntax check exists to close
    it("does not recognise prose connectors", () => {
        const line = "Right click on your AKS cluster and select **Troubleshoot Network Health**";
        assert.deepEqual(crumbsIn(line), []);
    });
});

describe("proseNavIn", () => {
    const prose = [
        "Right click on your AKS cluster and select **Compare AKS Cluster** to diff two clusters.",
        "Right click on your AKS cluster and click on **Run Kubectl Commands** to run them.",
        "Right-click on your AKS cluster and select **Investigate DNS** to troubleshoot DNS.",
    ];

    for (const line of prose) {
        it(`flags: ${line.slice(0, 56)}...`, () => {
            const hit = proseNavIn(line);
            assert.ok(hit, "expected a violation");
            assert.match(hit.bold, /^\*\*.+\*\*$/);
            assert.ok(!hit.connector.endsWith(">"), "connector should not be the convention");
        });
    }

    it("accepts the convention", () => {
        assert.equal(proseNavIn("Right click on your AKS cluster > **Troubleshoot Network Health**"), null);
    });

    it("accepts a multi-step chain in the convention", () => {
        const line = "Right click on your AKS cluster > **Troubleshoot & Diagnose** > **Collect TCP Dumps**";
        assert.equal(proseNavIn(line), null);
    });

    // a line menu-paths can already read is checked, so flagging it here would
    // duplicate an error raised against the same line
    it("defers to menu-paths when the line yields a breadcrumb", () => {
        const line = "Right-click your AKS cluster and select **Troubleshoot Network Health** > **Run Retina Capture**";
        assert.ok(crumbsIn(line).length, "precondition: menu-paths can read this line");
        assert.equal(proseNavIn(line), null);
    });

    it("ignores bold that precedes the right-click", () => {
        // naming a UI element is not an instruction
        const line = "- The **AKS cluster context menu** (right-click on a cluster in the Cloud Explorer).";
        assert.equal(proseNavIn(line), null);
    });

    it("does not cross a sentence boundary", () => {
        const line = "You can right click on your AKS cluster to see actions. Then read **Some Heading** below.";
        assert.equal(proseNavIn(line), null);
    });

    it("ignores a line with no right-click", () => {
        assert.equal(proseNavIn("Open the palette and run **AKS: Create Cluster**."), null);
    });
});

describe("withoutFencedCode", () => {
    it("blanks a fenced block but keeps line numbers", () => {
        const input = ["before aks.realCommand", "```json", '{ "azure.other.setting": true }', "```", "after"].join(
            "\n",
        );
        const out = withoutFencedCode(input);
        assert.equal(out.split("\n").length, input.split("\n").length);
        assert.ok(!out.includes("azure.other.setting"), "fenced content should be blanked");
        assert.ok(out.includes("aks.realCommand"), "prose outside the fence is untouched");
    });

    it("handles tilde fences", () => {
        const out = withoutFencedCode(["~~~yaml", "aks.fake/annotation: x", "~~~"].join("\n"));
        assert.ok(!out.includes("aks.fake"));
    });

    it("leaves inline code alone, which coverage relies on", () => {
        const line = "Run `aks.periscope` from the palette.";
        assert.equal(withoutFencedCode(line), line);
    });
});

describe("withoutUrls", () => {
    // Asserted as exact output rather than a substring check on the host.
    // `!out.includes("dev.azure.com")` reads to CodeQL as an incomplete URL
    // sanitiser (js/incomplete-url-substring-sanitization), and equality is the
    // stronger assertion anyway: it pins the blanking width, not just absence.
    const blanked = (s) => " ".repeat(s.length);

    it("blanks a URL so its host is not read as an identifier", () => {
        const url = "https://dev.azure.com/foo";
        assert.equal(withoutUrls(`See ${url} for details`), `See ${blanked(url)} for details`);
    });

    it("blanks a relative link target but keeps the text", () => {
        // the `](...)` branch: a target that is not a URL, so the URL rule
        // above does not consume it first
        const target = "](./other-page.md)";
        assert.equal(withoutUrls(`[the docs]${target.slice(1)}`), `[the docs${blanked(target)}`);
    });

    it("preserves line count", () => {
        const input = "a\nhttps://example.com/x\nb";
        assert.equal(withoutUrls(input).split("\n").length, 3);
    });
});
