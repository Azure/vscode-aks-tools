#!/usr/bin/env node
/**
 * Documentation checks that need knowledge of package.json.
 *
 * Deliberately does NOT check links, images, anchors, or SUMMARY completeness.
 * `lychee --offline --include-fragments` covers the first three and handles raw
 * HTML and URL fragments properly; `mdbook build` with `create-missing = false`
 * fails on a SUMMARY entry with no page. Both run in CI. Duplicating them here
 * was worse, not better: an earlier version of this file missed images
 * referenced with <img> tags, which lychee caught.
 *
 * Checks:
 *   identifiers   command IDs in prose that package.json does not contribute
 *   menu-paths    menu breadcrumbs that do not match the real menu
 *   coverage      commands documented nowhere in prose (warning)
 *   orphans       images no page references (warning)
 *
 * Usage:
 *   node scripts/docs-check.js                  all checks
 *   node scripts/docs-check.js menu-paths       named checks only
 *
 * Errors exit 1. Warnings do not.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { loc, contributes, walk: walkMenus, DEFAULT_SIMPLIFIED } = require("./lib/menu-graph");

const REPO_ROOT = path.resolve(__dirname, "..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs");
const BOOK_SRC = path.join(DOCS_ROOT, "book", "src");

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"];

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// mdBook writes its rendered site into docs/book/book/, which mirrors every page
// and image. Walking it would double-count everything.
const BOOK_OUTPUT = path.join(DOCS_ROOT, "book", "book");
const SKIP_DIRS = new Set(["node_modules", ".git"]);

function walk(dir, predicate, found = []) {
    if (!fs.existsSync(dir) || path.resolve(dir) === BOOK_OUTPUT) {
        return found;
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) {
                continue;
            }
            walk(full, predicate, found);
        } else if (predicate(full)) {
            found.push(full);
        }
    }
    return found;
}

const markdownFiles = () => walk(DOCS_ROOT, (f) => f.endsWith(".md")).sort();
const bookFiles = () => walk(BOOK_SRC, (f) => f.endsWith(".md")).sort();
const imageFiles = () => walk(DOCS_ROOT, (f) => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase())).sort();

const rel = (p) => path.relative(REPO_ROOT, p);

/** Line number of a character offset. */
function lineAt(text, index) {
    return text.slice(0, index).split("\n").length;
}

/**
 * Blank out URLs and link targets, so hostnames like `dev.azure.com` are not mistaken
 * for extension identifiers. Newlines are preserved so line numbers stay accurate.
 */
function withoutUrls(text) {
    const blank = (m) => m.replace(/[^\n]/g, " ");
    return text
        .replace(/https?:\/\/\S+/g, blank)
        .replace(/\]\([^)]*\)/g, blank)
        .replace(/<[^>\s]+>/g, blank);
}

/**
 * Blank out fenced code blocks, keeping the fences so line numbers stay accurate.
 *
 * Samples are quoted from elsewhere: a settings.json snippet naming another
 * extension's `azure.*` key, or YAML carrying an `aks.*` annotation, is not a
 * claim about what this extension contributes, and should not be a hard error.
 * Inline code is left alone — the docs use it to name real commands, and the
 * coverage check relies on that.
 */
function withoutFencedCode(text) {
    const blank = (m) => m.replace(/[^\n]/g, " ");
    return text.replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^[ \t]*\2[^\n]*$/gm, (match, indent, fence, body) =>
        match.replace(body, blank(body)),
    );
}

/** Every `[text](target)` link in a file, with its line number. */
function linksOf(file) {
    const text = fs.readFileSync(file, "utf8");
    const links = [];
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        links.push({ target: match[1], line: lineAt(text, match.index), isImage: match[0].startsWith("!") });
    }
    // markdown allows raw HTML, and several pages use <img> to control size.
    // Missing these made referenced images look orphaned.
    for (const match of text.matchAll(/<img\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']/gi)) {
        links.push({ target: match[1], line: lineAt(text, match.index), isImage: true });
    }
    for (const match of text.matchAll(/<a\b[^>]*?\shref\s*=\s*["']([^"']+)["']/gi)) {
        links.push({ target: match[1], line: lineAt(text, match.index), isImage: false });
    }
    return links;
}

// ---------------------------------------------------------------------------
// package.json facts
// ---------------------------------------------------------------------------

// package.json is read once by lib/menu-graph, which also owns %placeholder%
// resolution. Resolving titles a second time here meant two implementations that
// disagreed on a missing NLS key: loc() throws, the old local copy fell back to
// the raw "%key%" string and let it through.
function contributions() {
    const commands = new Map((contributes.commands ?? []).map((c) => [c.command, loc(c.title)]));

    const settings = new Set();
    const configuration = contributes.configuration ?? {};
    for (const block of Array.isArray(configuration) ? configuration : [configuration]) {
        for (const key of Object.keys(block.properties ?? {})) {
            settings.add(key);
        }
    }

    const submenus = new Set((contributes.submenus ?? []).map((s) => s.id));

    return { commands, settings, submenus };
}

/** Command IDs registered in src/ but possibly not declared in contributes.commands. */
function registeredInSource() {
    const sources = walk(path.join(REPO_ROOT, "src"), (f) => f.endsWith(".ts"));
    const ids = new Set();
    for (const file of sources) {
        const text = fs.readFileSync(file, "utf8");
        for (const match of text.matchAll(/registerCommand(?:WithTelemetry)?\(\s*["']([\w.]+)["']/g)) {
            ids.add(match[1]);
        }
    }
    return ids;
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

const checks = {};

checks.identifiers = (report) => {
    const { commands, settings, submenus } = contributions();
    const registered = registeredInSource();

    // Kubernetes annotation prefixes and similar non-extension namespaces.
    const notIdentifiers = /^(azure\.workload\.identity|aks\.ghcp)$/;

    for (const file of bookFiles()) {
        const raw = fs.readFileSync(file, "utf8");
        const text = withoutFencedCode(withoutUrls(raw));
        for (const match of text.matchAll(
            /(?<![\w.])((?:aks|azure)\.[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*)\b/g,
        )) {
            const id = match[1];
            if (commands.has(id) || settings.has(id) || submenus.has(id) || notIdentifiers.test(id)) {
                continue;
            }
            // Annotation or path prefixes such as `azure.workload.identity/use`.
            if (text[match.index + id.length] === "/") {
                continue;
            }
            const where = `${rel(file)}:${lineAt(text, match.index)}`;
            if (registered.has(id)) {
                report.warn(
                    where,
                    `${id} is registered in src/ but absent from contributes.commands, so it is not in the Command Palette`,
                );
            } else {
                report.error(where, `unknown identifier: ${id}`);
            }
        }
    }
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

checks.coverage = (report) => {
    const { commands } = contributions();
    // generated reference pages list every command, so counting them would make
    // this check pass trivially; coverage means documented in prose
    const corpus = bookFiles()
        .filter((f) => !rel(f).includes(`${path.sep}reference${path.sep}`))
        .map((f) => fs.readFileSync(f, "utf8"))
        .join("\n");

    for (const [id, title] of commands) {
        // the command ID is distinctive enough to count on its own
        if (corpus.includes(id)) {
            continue;
        }

        const plain = String(title ?? "")
            .replace(/^AKS:\s*/i, "")
            .trim();
        if (!plain) {
            report.warn("coverage", `command documented nowhere: ${id}`);
            continue;
        }

        // A title only counts when it stands alone as a UI string — **Bold**,
        // `code`, a heading, or a list item naming just that command. A plain
        // substring match treated any prose containing "storage" as
        // documentation for the Storage detector, and likewise for Best
        // Practices, Node Health and Profile CPU, so the check passed for
        // commands that are documented nowhere.
        // Titles ending in an ellipsis are conventionally written without it in
        // prose ("AKS: Sign in to Azure" for "Sign in to Azure...").
        const base = plain.replace(/\.{3}$/, "");
        const t = escapeRe(base) + (base === plain ? "" : "(?:\\.{3})?");
        const documented = new RegExp(
            [
                `\\*\\*\\s*(?:AKS:\\s*)?${t}\\s*\\*\\*`,
                `\`\\s*(?:AKS:\\s*)?${t}\\s*\``,
                `^#{1,6}\\s*(?:AKS:\\s*)?${t}\\s*$`,
                `^\\s*[-*]\\s+(?:AKS:\\s*)?${t}\\s*$`,
            ].join("|"),
            "im",
        );
        if (documented.test(corpus)) {
            continue;
        }

        report.warn("coverage", `command documented nowhere: ${id} ("${title}")`);
    }
};

checks.orphans = (report) => {
    const referenced = new Set();
    for (const file of markdownFiles()) {
        const dir = path.dirname(file);
        for (const { target, isImage } of linksOf(file)) {
            if (isImage && !/^https?:/.test(target)) {
                referenced.add(path.resolve(dir, target.split("#")[0]));
            }
        }
    }
    for (const image of imageFiles()) {
        if (!referenced.has(image)) {
            report.warn("orphans", `image referenced by no page: ${rel(image)}`);
        }
    }
};

// Menu breadcrumbs written as **A** > **B** > **C**. Docs describe the default
// (grouped) menu; a page that documents the classic layout opts out with the
// marker below, which is documented for docs authors in docs/package-scripts.md.
const CLASSIC_MARKER = "docs-check: classic-menu";
const BOLD_CHAIN = /(?:\*\*[^*\n]+\*\*)(?:\s*>\s*\*\*[^*\n]+\*\*)+/g;
// a single bold segment is only a menu path when the prose anchors it to a
// right-click, which is what catches a command documented on the wrong node.
// group 1 is the text naming the node, group 2 the breadcrumb.
const RIGHT_CLICK = /right[- ]click([^.\n*]*?)>\s*(\*\*[^*\n]+\*\*(?:\s*>\s*\*\*[^*\n]+\*\*)*)/gi;

/**
 * Which tree node the prose leading up to a breadcrumb refers to.
 *
 * Only the text before the breadcrumb is considered. Scanning the whole line
 * misread ordinary sentences: "Right-click your AKS cluster > **Manage Cluster**
 * > **Delete Cluster**. This removes the fleet member too." resolved to the
 * fleet node and failed a correct page.
 */
function nodeFromContext(before) {
    if (/\bfleets?\b/i.test(before)) return "fleet";
    if (/\bsubscriptions?\b/i.test(before)) return "subscription";
    return "cluster";
}

/** Breadcrumbs in a line, each paired with the node its lead-in names. */
function crumbsIn(line) {
    const out = new Map();
    for (const m of line.matchAll(RIGHT_CLICK)) {
        out.set(m[2], nodeFromContext(m[1]));
    }
    for (const m of line.matchAll(BOLD_CHAIN)) {
        if (!out.has(m[0])) out.set(m[0], nodeFromContext(line.slice(0, m.index)));
    }
    return [...out].map(([crumb, root]) => ({ crumb, root }));
}

checks["menu-paths"] = (report) => {
    const dflt = walkMenus(DEFAULT_SIMPLIFIED).labelPaths;
    const classic = walkMenus(!DEFAULT_SIMPLIFIED).labelPaths;

    // a bold sequence is only treated as a menu path if at least one segment
    // names a real command or submenu, so prose like **Submit** > **Next** is ignored
    const menuLabels = new Set([
        ...contributes.commands.map((c) => loc(c.title)),
        ...contributes.submenus.map((sm) => loc(sm.label)),
    ]);

    // where each label actually lives, for the error message
    const homeOf = new Map();
    for (const key of dflt) {
        const [node, crumb] = key.split("|");
        const leaf = crumb.split(" > ").pop();
        if (!homeOf.has(leaf)) homeOf.set(leaf, `${node}: ${crumb}`);
    }

    for (const file of bookFiles()) {
        const text = fs.readFileSync(file, "utf8");
        // Looked for outside code fences, so a page documenting the marker does
        // not thereby opt itself out. Line scanning below still uses the raw
        // text: a menu path quoted in a fence should still be correct.
        const allowClassic = withoutFencedCode(text).includes(CLASSIC_MARKER);

        text.split("\n").forEach((line, index) => {
            for (const { crumb: match, root } of crumbsIn(line)) {
                const labels = [...match.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim());
                if (!labels.some((l) => menuLabels.has(l))) {
                    continue;
                }
                const where = `${rel(file)}:${index + 1}`;
                const crumb = labels.join(" > ");

                if (dflt.has(`${root}|${crumb}`)) {
                    continue;
                }
                if (allowClassic && classic.has(`${root}|${crumb}`)) {
                    continue;
                }

                const otherRoot = [...dflt].find((k) => k.endsWith(`|${crumb}`));
                if (otherRoot) {
                    report.error(where, `menu path is on the ${otherRoot.split("|")[0]} node, not ${root}: ${crumb}`);
                    continue;
                }
                if (classic.has(`${root}|${crumb}`)) {
                    report.error(where, `menu path describes the classic menu: ${crumb}`);
                    continue;
                }
                const leaf = labels[labels.length - 1];
                const home = homeOf.get(leaf);
                report.error(
                    where,
                    home ? `menu path is wrong: ${crumb} — ${leaf} is at ${home}` : `menu path not found: ${crumb}`,
                );
            }
        });
    }
};

/**
 * Navigation must be written as **A** > **B**, not joined by prose.
 *
 * `menu-paths` recognises a breadcrumb only when `>` separates the steps, so an
 * instruction written "and select **X** and then click on **Y**" is skipped
 * rather than validated. That failure is silent, which is the same shape of
 * problem the menu checks exist to prevent: 26 of the 28 right-click
 * instructions naming a bold UI element were invisible to `menu-paths`.
 *
 * Teaching the parser the connector phrases was tried and rejected. Prose does
 * not distinguish a menu hop from a step inside a wizard — both are written
 * "and select" — so `**Create Cluster** and select **Create Standard Cluster**`
 * reads as a two-level menu path when the second is a button in the dialog the
 * first opens. `>` lets the author state that boundary, and the phrase list
 * would never be complete anyway.
 *
 * This check knows nothing about the menu, only about the convention, so it
 * cannot make that mistake.
 */
const NOT_A_MENU = "docs-check: not-a-menu";
// Anchored at the end of the previous step, so group 1 is the connector that
// led to this bold segment.
const NAV_STEP = /([^*\n]*?)(\*\*[^*\n]+\*\*)/gy;

/**
 * The first prose-connected step in a right-click instruction, or null.
 *
 * A line `menu-paths` can already read is exempt whatever its connectors:
 * reporting it here as well would duplicate, against the same line, an error
 * `menu-paths` already raises.
 */
function proseNavIn(line) {
    if (crumbsIn(line).length) {
        return null;
    }
    for (const anchor of line.matchAll(/right[- ]click/gi)) {
        // Only text after the right-click counts. A page describing "the **AKS
        // cluster context menu** (right-click ...)" names a bold UI element
        // without giving an instruction, and is not a breadcrumb.
        NAV_STEP.lastIndex = anchor.index + anchor[0].length;
        let step;
        while ((step = NAV_STEP.exec(line))) {
            const [, connector, bold] = step;
            // a sentence boundary ends the instruction
            if (connector.includes(".")) {
                break;
            }
            if (!connector.trimEnd().endsWith(">")) {
                return { connector: connector.trim(), bold };
            }
            NAV_STEP.lastIndex = step.index + step[0].length;
        }
    }
    return null;
}

checks["menu-syntax"] = (report) => {
    for (const file of bookFiles()) {
        const raw = fs.readFileSync(file, "utf8");
        // a bold chain inside a code sample is not an instruction
        const text = withoutFencedCode(raw);
        // Checked against the same blanked text, so the page documenting this
        // marker does not opt itself out of the check it describes.
        if (text.includes(NOT_A_MENU)) {
            continue;
        }
        text.split("\n").forEach((line, index) => {
            const hit = proseNavIn(line);
            if (!hit) {
                return;
            }
            report.error(
                `${rel(file)}:${index + 1}`,
                "write menu navigation as `**A** > **B**`, not prose: " +
                    `"...${hit.connector} ${hit.bold}" — otherwise menu-paths cannot check it`,
            );
        });
    }
};

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

function main() {
    const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
    const names = requested.length ? requested : Object.keys(checks);

    const unknown = names.filter((n) => !checks[n]);
    if (unknown.length) {
        console.error(`Unknown check(s): ${unknown.join(", ")}`);
        console.error(`Available: ${Object.keys(checks).join(", ")}`);
        process.exitCode = 2;
        return;
    }

    let errors = 0;
    let warnings = 0;

    for (const name of names) {
        const found = [];
        checks[name]({
            error: (where, message) => found.push({ level: "error", where, message }),
            warn: (where, message) => found.push({ level: "warn", where, message }),
        });

        const e = found.filter((f) => f.level === "error").length;
        const w = found.length - e;
        errors += e;
        warnings += w;

        const status = e ? "FAIL" : w ? "warn" : "ok";
        console.log(`\n[${status}] ${name}${found.length ? ` — ${e} error(s), ${w} warning(s)` : ""}`);
        for (const f of found) {
            console.log(`  ${f.level === "error" ? "E" : "W"}  ${f.where}\n     ${f.message}`);
        }
    }

    console.log(`\n${errors} error(s), ${warnings} warning(s)`);
    // `process.exit()` here would discard buffered stdout when it is a pipe
    // rather than a TTY, which is how CI runs this. Setting the code and
    // returning lets node flush and exit on its own.
    process.exitCode = errors ? 1 : 0;
}

// Running the file executes the checks; requiring it exposes the line-level
// parsers so they can be tested without a book on disk.
if (require.main === module) {
    main();
}

module.exports = { crumbsIn, proseNavIn, withoutFencedCode, withoutUrls };
