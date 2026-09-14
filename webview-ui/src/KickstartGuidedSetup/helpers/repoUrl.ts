import * as l10n from "@vscode/l10n";

export type RepoUrlResult = { ok: true; url: string; note: string | null } | { ok: false; message: string };

/** Web UI paths that can trail a GitHub repo URL when someone copies from the address bar. */
const GITHUB_SUBPATH = /\/(?:tree|blob|commits?|releases|issues|pulls?|actions|wiki|settings)(?:\/.*)?$/i;
const GITHUB_REPO = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/i;
/** `git@host:owner/repo.git` — the SCP-like form git accepts but which isn't a URL. */
const SCP_LIKE = /^[\w.-]+@[\w.-]+:[\w./~-]+$/;
/** Bare `owner/repo`, which we expand to a GitHub URL. */
const SHORTHAND = /^[\w.-]+\/[\w.-]+$/;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Validate a user-supplied repository URL and normalize the forms people actually paste.
 *
 * Deliberately permissive about host: the agent clones with plain `git`, so GitLab, Bitbucket and
 * Azure DevOps URLs are all legitimate. The checks catch shapes `git clone` would reject outright,
 * plus GitHub web URLs that point at a subpath rather than the repository root.
 */
export function normalizeRepoUrl(raw: string): RepoUrlResult {
    const trimmed = raw.trim();

    if (!trimmed) {
        return { ok: false, message: l10n.t("A repository URL is required.") };
    }
    if (/\s/.test(trimmed)) {
        return { ok: false, message: l10n.t("A repository URL can't contain spaces.") };
    }

    // `git@github.com:owner/repo.git` — clone accepts it verbatim.
    if (SCP_LIKE.test(trimmed)) {
        return { ok: true, url: trimmed, note: null };
    }

    // `owner/repo` with no host at all.
    if (SHORTHAND.test(trimmed)) {
        return {
            ok: true,
            url: `https://github.com/${trimmed}`,
            note: l10n.t("Interpreted as a GitHub repository."),
        };
    }

    const withScheme = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed}`;

    let parsed: URL;
    try {
        parsed = new URL(withScheme);
    } catch {
        return { ok: false, message: l10n.t("That doesn't look like a repository URL.") };
    }

    if (!parsed.hostname.includes(".")) {
        return { ok: false, message: l10n.t("That doesn't look like a repository URL.") };
    }
    if (parsed.pathname.replace(/\/+$/, "") === "") {
        return { ok: false, message: l10n.t("The URL is missing a repository path.") };
    }

    const githubMatch = withScheme.match(GITHUB_REPO);
    if (githubMatch) {
        const [, owner, repo] = githubMatch;
        // Collapse every GitHub form to one canonical shape, keeping a .git suffix if it was typed.
        const root = `https://github.com/${owner}/${repo}${/\.git$/i.test(trimmed) ? ".git" : ""}`;
        const hadSubpath = GITHUB_SUBPATH.test(parsed.pathname);
        return { ok: true, url: root, note: hadSubpath ? l10n.t("Trimmed to the repository root.") : null };
    }

    return {
        ok: true,
        url: withScheme,
        note: HAS_SCHEME.test(trimmed) ? null : l10n.t("Assumed https."),
    };
}
