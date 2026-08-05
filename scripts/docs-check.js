"use strict";

/**
 * Documentation consistency checker.
 *
 * Validates the docs tree against itself and against package.json, which is the
 * source of truth for command IDs, settings, and menu structure.
 *
 * Usage:
 *   node scripts/docs-check.js              run every check
 *   node scripts/docs-check.js links images run only the named checks
 *
 * Exits non-zero if any check reports an error. Warnings never fail the run.
 */

const fs = require("fs");
const path = require("path");
const { loc, contributes, walk: walkMenus, DEFAULT_SIMPLIFIED } = require("./lib/menu-graph");

const REPO_ROOT = path.resolve(__dirname, "..");
const DOCS_ROOT = path.join(REPO_ROOT, "docs");
const BOOK_SRC = path.join(DOCS_ROOT, "book", "src");
const SUMMARY = path.join(BOOK_SRC, "SUMMARY.md");

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

/** Strip fenced code blocks so their contents are not treated as prose. */
function withoutFencedCode(text) {
    return text.replace(/^```[\s\S]*?^```/gm, (block) => block.replace(/[^\n]/g, " "));
}

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
 * Slugify a heading the way mdbook does: lowercase, drop anything that is not
 * alphanumeric/space/hyphen, collapse spaces to hyphens.
 */
function slugify(heading) {
    return heading
        .replace(/`([^`]*)`/g, "$1")
        .replace(/[*_]/g, "")
        .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 -]/g, "")
        .trim()
        .replace(/\s+/g, "-");
}

/** All heading anchors in a markdown file, including mdbook's duplicate suffixes. */
function anchorsOf(file) {
    const text = withoutFencedCode(fs.readFileSync(file, "utf8"));
    const seen = new Map();
    const anchors = new Set();
    for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
        const base = slugify(match[1]);
        if (!base) {
            continue;
        }
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        anchors.add(count === 0 ? base : `${base}-${count}`);
    }
    return anchors;
}

/** Every `[text](target)` link in a file, with its line number. */
function linksOf(file) {
    const text = fs.readFileSync(file, "utf8");
    const links = [];
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        links.push({ target: match[1], line: lineAt(text, match.index), isImage: match[0].startsWith("!") });
    }
    return links;
}

// ---------------------------------------------------------------------------
// package.json facts
// ---------------------------------------------------------------------------

function contributions() {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
    const nls = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.nls.json"), "utf8"));
    const contributes = pkg.contributes ?? {};

    const resolveTitle = (title) =>
        typeof title === "string" && title.startsWith("%") && title.endsWith("%")
            ? (nls[title.slice(1, -1)] ?? title)
            : title;

    const commands = new Map((contributes.commands ?? []).map((c) => [c.command, resolveTitle(c.title)]));

    const settings = new Set();
    const configuration = contributes.configuration ?? {};
    for (const block of Array.isArray(configuration) ? configuration : [configuration]) {
        for (const key of Object.keys(block.properties ?? {})) {
            settings.add(key);
        }
    }

    const submenus = new Set((contributes.submenus ?? []).map((s) => s.id));

    return { version: pkg.version, commands, settings, submenus };
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

checks.links = (report) => {
    for (const file of markdownFiles()) {
        const dir = path.dirname(file);
        for (const { target, line, isImage } of linksOf(file)) {
            if (isImage || /^(https?:|mailto:|#)/.test(target)) {
                continue;
            }
            const [filePart] = target.split("#");
            if (!filePart) {
                continue;
            }
            const resolved = path.resolve(dir, filePart);
            if (!fs.existsSync(resolved)) {
                report.error(`${rel(file)}:${line}`, `link target does not exist: ${target}`);
            }
        }
    }
};

checks.images = (report) => {
    for (const file of markdownFiles()) {
        const dir = path.dirname(file);
        for (const { target, line, isImage } of linksOf(file)) {
            if (!isImage || /^https?:/.test(target)) {
                continue;
            }
            if (!fs.existsSync(path.resolve(dir, target.split("#")[0]))) {
                report.error(`${rel(file)}:${line}`, `image does not exist: ${target}`);
            }
        }
    }
};

checks.anchors = (report) => {
    const cache = new Map();
    const anchorsFor = (file) => {
        if (!cache.has(file)) {
            cache.set(file, anchorsOf(file));
        }
        return cache.get(file);
    };

    for (const file of markdownFiles()) {
        const dir = path.dirname(file);
        for (const { target, line, isImage } of linksOf(file)) {
            if (isImage || /^(https?:|mailto:)/.test(target) || !target.includes("#")) {
                continue;
            }
            const [filePart, fragment] = target.split("#");
            if (!fragment) {
                continue;
            }
            const targetFile = filePart ? path.resolve(dir, filePart) : file;
            if (!targetFile.endsWith(".md") || !fs.existsSync(targetFile)) {
                continue; // missing file already reported by the links check
            }
            if (!anchorsFor(targetFile).has(fragment.toLowerCase())) {
                report.error(`${rel(file)}:${line}`, `anchor not found in ${path.basename(targetFile)}: #${fragment}`);
            }
        }
    }
};

checks.summary = (report) => {
    if (!fs.existsSync(SUMMARY)) {
        report.error(rel(SUMMARY), "SUMMARY.md is missing");
        return;
    }
    for (const { target, line } of linksOf(SUMMARY)) {
        if (/^https?:/.test(target)) {
            continue;
        }
        const resolved = path.resolve(BOOK_SRC, target.split("#")[0]);
        if (!fs.existsSync(resolved)) {
            report.error(
                `${rel(SUMMARY)}:${line}`,
                `entry points at a missing page: ${target} (mdbook create-missing would render this blank)`,
            );
        }
    }
};

checks.identifiers = (report) => {
    const { commands, settings, submenus } = contributions();
    const registered = registeredInSource();

    // Kubernetes annotation prefixes and similar non-extension namespaces.
    const notIdentifiers = /^(azure\.workload\.identity|aks\.ghcp)$/;

    for (const file of bookFiles()) {
        const raw = fs.readFileSync(file, "utf8");
        const text = withoutUrls(raw);
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

checks.coverage = (report) => {
    const { commands } = contributions();
    // generated reference pages list every command, so counting them would make
    // this check pass trivially; coverage means documented in prose
    const corpus = bookFiles()
        .filter((f) => !rel(f).includes(`${path.sep}reference${path.sep}`))
        .map((f) => fs.readFileSync(f, "utf8"))
        .join("\n")
        .toLowerCase();

    for (const [id, title] of commands) {
        if (corpus.includes(id.toLowerCase())) {
            continue;
        }
        const plainTitle = String(title ?? "")
            .replace(/^AKS:\s*/i, "")
            .toLowerCase();
        if (plainTitle && corpus.includes(plainTitle)) {
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
// marker below.
const CLASSIC_MARKER = "docs-check: classic-menu";
const BOLD_CHAIN = /(?:\*\*[^*\n]+\*\*)(?:\s*>\s*\*\*[^*\n]+\*\*)+/g;
// a single bold segment is only a menu path when the prose anchors it to a
// right-click, which is what catches a command documented on the wrong node
const RIGHT_CLICK = /right[- ]click[^.\n*]*?>\s*(\*\*[^*\n]+\*\*(?:\s*>\s*\*\*[^*\n]+\*\*)*)/gi;

function crumbsIn(line) {
    const out = new Set();
    for (const m of line.matchAll(RIGHT_CLICK)) out.add(m[1]);
    for (const m of line.match(BOLD_CHAIN) || []) out.add(m);
    return [...out];
}

/** Which tree node the surrounding prose says to right-click. */
function rootOf(line) {
    if (/\bfleet\b/i.test(line)) return "fleet";
    if (/\bsubscription\b/i.test(line)) return "subscription";
    return "cluster";
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
        const allowClassic = text.includes(CLASSIC_MARKER);

        text.split("\n").forEach((line, index) => {
            for (const match of crumbsIn(line)) {
                const labels = [...match.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1].trim());
                if (!labels.some((l) => menuLabels.has(l))) {
                    continue;
                }
                const where = `${rel(file)}:${index + 1}`;
                const crumb = labels.join(" > ");
                const root = rootOf(line);

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
        process.exit(2);
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
    process.exit(errors ? 1 : 0);
}

main();
