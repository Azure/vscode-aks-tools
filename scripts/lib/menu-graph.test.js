"use strict";

/**
 * Unit tests for the `when`-clause parser behind the docs tooling.
 *
 * These run on plain node with no compile step:
 *   npm run test:scripts
 *
 * The cases below are grouped as parser primitives first, then the three
 * regressions found in review: the submenu cycle guard, `false`/`never` reading
 * as reachable, and the equality form of a node predicate resolving to "any".
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const graph = require("./menu-graph");
const { splitTop, stripOuterParens, normaliseBoolean, evaluateWhen } = graph;

const MENU_MODE = "config.aks.simplifiedMenuStructure";

describe("splitTop", () => {
    it("splits on the separator at depth 0", () => {
        assert.deepEqual(splitTop("a && b && c", "&&"), ["a", "b", "c"]);
    });

    it("does not split inside parentheses", () => {
        assert.deepEqual(splitTop("(a && b) || c", "||"), ["(a && b)", "c"]);
    });

    it("keeps a nested separator with its group", () => {
        assert.deepEqual(splitTop("(a || (b || c)) || d", "||"), ["(a || (b || c))", "d"]);
    });

    it("trims and drops empty segments", () => {
        assert.deepEqual(splitTop("  a  &&   && b ", "&&"), ["a", "b"]);
    });

    it("returns a single element when the separator is absent", () => {
        assert.deepEqual(splitTop("viewItem == aks.cluster", "||"), ["viewItem == aks.cluster"]);
    });
});

describe("stripOuterParens", () => {
    it("removes one wrapping pair", () => {
        assert.equal(stripOuterParens("(a && b)"), "a && b");
    });

    it("removes repeated wrapping pairs", () => {
        assert.equal(stripOuterParens("((a))"), "a");
    });

    it("leaves adjacent groups alone", () => {
        // the outer parens here are not a matching pair around the whole string
        assert.equal(stripOuterParens("(a) && (b)"), "(a) && (b)");
    });

    it("is a no-op on an unwrapped clause", () => {
        assert.equal(stripOuterParens(" a && b "), "a && b");
    });
});

describe("normaliseBoolean", () => {
    const cases = [
        ["key", "key", false],
        ["!key", "key", true],
        ["!!key", "key", false],
        ["key == true", "key", false],
        ["key != false", "key", false],
        ["key == false", "key", true],
        ["key != true", "key", true],
        ["!key == false", "key", false],
    ];

    for (const [input, key, negated] of cases) {
        it(`${input} -> ${negated ? "!" : ""}${key}`, () => {
            assert.deepEqual(normaliseBoolean(input), { key, negated });
        });
    }

    it("collapses the equivalent forms of the menu-mode key to one key", () => {
        // package.json already uses the `== true` form for other settings, so
        // treating it as an ordinary runtime flag would put a command in both
        // menu columns.
        for (const form of [MENU_MODE, `${MENU_MODE} == true`, `${MENU_MODE} != false`]) {
            assert.deepEqual(normaliseBoolean(form), { key: MENU_MODE, negated: false });
        }
        for (const form of [`!${MENU_MODE}`, `${MENU_MODE} == false`, `${MENU_MODE} != true`]) {
            assert.deepEqual(normaliseBoolean(form), { key: MENU_MODE, negated: true });
        }
    });
});

describe("evaluateWhen", () => {
    it("treats an absent clause as reachable on any node", () => {
        assert.deepEqual(evaluateWhen(undefined, true), [{ node: "any", flags: [] }]);
    });

    it("honours the menu mode", () => {
        const when = `viewItem =~ /aks\\.cluster/i && ${MENU_MODE}`;
        assert.deepEqual(evaluateWhen(when, true), [{ node: "cluster", flags: [] }]);
        assert.deepEqual(evaluateWhen(when, false), []);
    });

    it("honours a negated menu mode", () => {
        const when = `viewItem =~ /aks\\.cluster/i && !${MENU_MODE}`;
        assert.deepEqual(evaluateWhen(when, false), [{ node: "cluster", flags: [] }]);
        assert.deepEqual(evaluateWhen(when, true), []);
    });

    it("reports other config keys as runtime flags rather than evaluating them", () => {
        const [hit] = evaluateWhen("viewItem =~ /aks\\.cluster/i && config.aks.argoCDEnabled", true);
        assert.equal(hit.node, "cluster");
        assert.deepEqual(hit.flags, ["config.aks.argoCDEnabled"]);
    });

    it("keeps each satisfiable disjunct", () => {
        const when = "viewItem =~ /aks\\.cluster/i || viewItem =~ /aks\\.fleet/i";
        assert.deepEqual(
            evaluateWhen(when, true).map((h) => h.node),
            ["cluster", "fleet"],
        );
    });

    // regression: a conjunct matching no rule used to be skipped, leaving the
    // disjunct satisfiable, so a hidden entry was reported as present in the menu
    for (const never of ["never", "false"]) {
        it(`treats \`${never}\` as unsatisfiable`, () => {
            assert.deepEqual(evaluateWhen(`viewItem =~ /aks\\.cluster/i && ${never}`, true), []);
            assert.deepEqual(evaluateWhen(never, true), []);
        });
    }

    it("treats a negated never as satisfiable", () => {
        assert.deepEqual(evaluateWhen("viewItem =~ /aks\\.cluster/i && !never", true), [
            { node: "cluster", flags: [] },
        ]);
    });

    // regression: only the subscription row tolerated `==`, so the equality form
    // of the other nodes fell through to "any" and rendered as `Any > ...`
    describe("resolves a node from both the regex and equality forms", () => {
        const nodes = [
            ["aks.cluster", "cluster"],
            ["aks.subscription", "subscription"],
            ["aks.fleet", "fleet"],
        ];
        for (const [viewItem, node] of nodes) {
            it(viewItem, () => {
                const escaped = viewItem.replace(".", "\\.");
                const regexForm = `view == kubernetes.cloudExplorer && viewItem =~ /${escaped}/i`;
                const equalityForm = `view == kubernetes.cloudExplorer && viewItem == ${viewItem}`;
                assert.deepEqual(evaluateWhen(regexForm, true), [{ node, flags: [] }]);
                assert.deepEqual(evaluateWhen(equalityForm, true), [{ node, flags: [] }]);
            });
        }
    });

    it("falls back to any when no node is named", () => {
        assert.deepEqual(evaluateWhen("workspaceFolderCount >= 1", true), [
            { node: "any", flags: ["workspaceFolderCount >= 1"] },
        ]);
    });
});

describe("walk", () => {
    it("produces a menu for both modes", () => {
        for (const simplified of [true, false]) {
            const { commandPaths, labelPaths } = graph.walk(simplified);
            assert.ok(commandPaths.size > 0, "expected commands in the menu");
            assert.ok(labelPaths.size > 0, "expected reachable label paths");
        }
    });

    it("records intermediate submenus, so a breadcrumb stopping at one validates", () => {
        const { labelPaths } = graph.walk(true);
        const nested = [...labelPaths].find((p) => p.includes(" > "));
        assert.ok(nested, "expected at least one nested path");
        const [node, crumb] = nested.split("|");
        const parent = crumb.split(" > ").slice(0, -1).join(" > ");
        assert.ok(labelPaths.has(`${node}|${parent}`), `parent path ${parent} should also be reachable`);
    });

    // regression: the guard keyed on bucket + breadcrumb, and the breadcrumb grows
    // on every hop, so the key was always fresh and an A -> B -> A pair recursed
    // until the stack overflowed
    it("stops on a submenu cycle instead of overflowing the stack", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "menu-graph-cycle-"));
        fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });

        const root = path.resolve(__dirname, "..", "..");
        const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
        pkg.contributes.submenus.push({ id: "cycleA", label: "A" }, { id: "cycleB", label: "B" });
        pkg.contributes.menus["view/item/context"].push({
            submenu: "cycleA",
            when: "viewItem =~ /aks\\.cluster/i",
        });
        pkg.contributes.menus.cycleA = [{ submenu: "cycleB" }];
        pkg.contributes.menus.cycleB = [{ submenu: "cycleA" }];

        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
        fs.copyFileSync(path.join(root, "package.nls.json"), path.join(dir, "package.nls.json"));
        fs.copyFileSync(
            path.join(root, "scripts", "lib", "menu-graph.js"),
            path.join(dir, "scripts", "lib", "menu-graph.js"),
        );

        const cyclic = require(path.join(dir, "scripts", "lib", "menu-graph.js"));
        const { labelPaths } = cyclic.walk(true);
        assert.ok(labelPaths.has("cluster|A"), "expected the cycle entry point to be reachable");
        assert.ok(labelPaths.has("cluster|A > B"), "expected one hop through the cycle");
        assert.ok(!labelPaths.has("cluster|A > B > A"), "expected the walk to stop before repeating a submenu");

        fs.rmSync(dir, { recursive: true, force: true });
    });
});
