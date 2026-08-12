"use strict";

/**
 * The AKS cluster context menu graph, derived from package.json.
 *
 * Shared by scripts/generate-docs-reference.js (which renders it) and
 * scripts/docs-check.js (which validates menu breadcrumbs in prose against it),
 * so the two can never disagree about the menu layout.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

const pkg = readJson("package.json");
const nls = readJson("package.nls.json");
const contributes = pkg.contributes;

/** Resolves a `%key%` placeholder against package.nls.json. */
function loc(value) {
    if (typeof value !== "string") return value;
    const m = /^%(.+)%$/.exec(value);
    if (!m) return value;
    if (!(m[1] in nls)) throw new Error(`package.nls.json has no entry for %${m[1]}%`);
    return nls[m[1]];
}

const MENU_MODE_KEY = "config.aks.simplifiedMenuStructure";

/** Splits on `sep` at paren depth 0. */
function splitTop(expr, sep) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < expr.length; i++) {
        const ch = expr[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (depth === 0 && expr.startsWith(sep, i)) {
            parts.push(expr.slice(start, i));
            i += sep.length - 1;
            start = i + 1;
        }
    }
    parts.push(expr.slice(start));
    return parts.map((s) => s.trim()).filter(Boolean);
}

function stripOuterParens(s) {
    let out = s.trim();
    while (out.startsWith("(") && out.endsWith(")")) {
        let depth = 0;
        let matched = true;
        for (let i = 0; i < out.length; i++) {
            if (out[i] === "(") depth++;
            else if (out[i] === ")") depth--;
            if (depth === 0 && i < out.length - 1) {
                matched = false;
                break;
            }
        }
        if (!matched) break;
        out = out.slice(1, -1).trim();
    }
    return out;
}

/**
 * Tree nodes a `when` clause can target, in match order. Adding a node type is
 * a new row here rather than a new branch.
 */
const NODE_PATTERNS = [
    [/viewItem\s*=~\s*\/aks\\?\.cluster/i, "cluster"],
    [/viewItem\s*[=~]+\s*\/?aks\\?\.subscription/i, "subscription"],
    [/viewItem\s*=~\s*\/aks\\?\.fleet/i, "fleet"],
    [/vsKubernetes/i, "k8s-cluster"],
    [/viewItem\s*=~\s*\/Azure\/i/, "azure"],
];

/**
 * Which tree node a clause targets. Returns "any" when the clause names none,
 * so nested entries inherit the node their parent submenu was attached to.
 */
function nodeOf(conjuncts) {
    const joined = conjuncts.join(" && ");
    const hit = NODE_PATTERNS.find(([pattern]) => pattern.test(joined));
    return hit ? hit[1] : "any";
}

/**
 * Collapses the equivalent boolean forms VS Code accepts into `{ key, negated }`:
 * `key`, `!key`, `key == true`, `key != false`, `key == false`, `key != true`.
 *
 * Without this, `config.aks.simplifiedMenuStructure == true` would not match the
 * menu-mode rule below and would be reported as an ordinary runtime flag, putting
 * the command in both menu columns. package.json already uses the `== true` form
 * for other settings, so this is one edit away from happening.
 */
function normaliseBoolean(conjunct) {
    let negated = false;
    let key = conjunct.trim();
    while (key.startsWith("!")) {
        negated = !negated;
        key = key.slice(1).trim();
    }
    const comparison = /^(.*?)\s*(==|!=)\s*(true|false)$/.exec(key);
    if (comparison) {
        key = comparison[1].trim();
        const assertsTrue = (comparison[2] === "==") === (comparison[3] === "true");
        if (!assertsTrue) negated = !negated;
    }
    return { key, negated };
}

/**
 * How a single conjunct is interpreted, in match order:
 *   satisfied  false means the disjunct cannot hold in this menu mode
 *   flag       true means it is a runtime condition to report, not to evaluate
 * A conjunct matching nothing here is a view/viewItem predicate, handled by nodeOf.
 */
const CONJUNCT_RULES = [
    {
        match: (n) => n.key === MENU_MODE_KEY,
        satisfied: (simplified, n) => (n.negated ? !simplified : simplified),
    },
    { match: (n) => /^config\./.test(n.key) || /^workspaceFolderCount/.test(n.key), flag: true },
];

/** Satisfiable disjuncts of a `when` clause under a fixed menu mode. */
function evaluateWhen(when, simplified) {
    if (!when) {
        return [{ node: "any", flags: [] }];
    }
    const results = [];
    for (const disjunct of splitTop(when, "||")) {
        const conjuncts = splitTop(stripOuterParens(disjunct), "&&");
        const flags = [];
        let ok = true;
        for (const raw of conjuncts) {
            const c = stripOuterParens(raw);
            const normalised = normaliseBoolean(c);
            const rule = CONJUNCT_RULES.find((r) => r.match(normalised));
            if (!rule) {
                continue;
            }
            if (rule.flag) {
                flags.push(c);
            } else if (!rule.satisfied(simplified, normalised)) {
                ok = false;
            }
        }
        if (ok) {
            results.push({ node: nodeOf(conjuncts), flags });
        }
    }
    return results;
}

const submenuById = new Map(contributes.submenus.map((s) => [s.id, s]));
const menus = contributes.menus;

/**
 * Walks the tree-view menus for one menu mode.
 *
 * Returns:
 *   commandPaths  Map<commandId, [{ node, breadcrumb, flags }]>
 *   labelPaths    Set<"node|Label > Label">, every reachable point in the tree,
 *                 including intermediate submenus, so a breadcrumb that stops at
 *                 a submenu still validates.
 */
function walk(simplified) {
    const commandPaths = new Map();
    const labelPaths = new Set();
    const active = new Set();

    const visit = (bucket, breadcrumb, node, flags) => {
        const key = `${bucket}|${breadcrumb.join(">")}`;
        if (active.has(key)) return; // submenu cycle guard
        active.add(key);

        for (const entry of menus[bucket] || []) {
            for (const hit of evaluateWhen(entry.when, simplified)) {
                const childNode = hit.node === "any" ? node : hit.node;
                const childFlags = [...new Set([...flags, ...hit.flags])];
                if (entry.submenu) {
                    const sub = submenuById.get(entry.submenu);
                    if (!sub) throw new Error(`menu references unknown submenu ${entry.submenu}`);
                    const crumb = [...breadcrumb, loc(sub.label)];
                    labelPaths.add(`${childNode}|${crumb.join(" > ")}`);
                    visit(entry.submenu, crumb, childNode, childFlags);
                } else if (entry.command) {
                    const cmd = contributes.commands.find((c) => c.command === entry.command);
                    if (cmd) labelPaths.add(`${childNode}|${[...breadcrumb, loc(cmd.title)].join(" > ")}`);
                    if (!commandPaths.has(entry.command)) commandPaths.set(entry.command, []);
                    commandPaths.get(entry.command).push({ node: childNode, breadcrumb, flags: childFlags });
                }
            }
        }
        active.delete(key);
    };

    visit("view/item/context", [], "any", []);
    return { commandPaths, labelPaths };
}

module.exports = {
    pkg,
    contributes,
    loc,
    splitTop,
    stripOuterParens,
    normaliseBoolean,
    evaluateWhen,
    submenuById,
    menus,
    walk,
    /** Menu mode the documentation is written against. */
    DEFAULT_SIMPLIFIED: true,
};
