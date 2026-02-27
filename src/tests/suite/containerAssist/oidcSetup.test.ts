import * as assert from "assert";
import * as vscode from "vscode";
import * as sinon from "sinon";
import sodium from "libsodium-wrappers";
import * as oidcSetup from "../../../commands/aksContainerAssist/oidcSetup";
import * as logger from "../../../commands/aksContainerAssist/logger";

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Builds a minimal Octokit-shaped stub whose methods can be individually configured. */
function makeMockOctokit() {
    return {
        repos: {
            get: sinon.stub(),
        },
        actions: {
            getRepoPublicKey: sinon.stub(),
            createOrUpdateRepoSecret: sinon.stub(),
        },
    };
}

/** Builds a fake Octokit RequestError with the given status and optional SSO header. */
function makeOctokitError(
    status: number,
    opts?: { ssoUrl?: string },
): {
    status: number;
    message: string;
    response: { headers: Record<string, string> };
} {
    const headers: Record<string, string> = {};
    if (opts?.ssoUrl) {
        headers["x-github-sso"] = `required; url=${opts.ssoUrl}`;
    }
    return {
        status,
        message: `HttpError ${status}`,
        response: { headers },
    };
}

const SSO_URL = "https://github.com/orgs/my-org/sso?authorization_request=XXXX";

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("setGitHubActionsSecrets", () => {
    let sandbox: sinon.SinonSandbox;
    let mockOctokit: ReturnType<typeof makeMockOctokit>;

    // VS Code stubs
    let showErrorStub: sinon.SinonStub;
    let showWarningStub: sinon.SinonStub;
    let showInfoStub: sinon.SinonStub;
    let openExternalStub: sinon.SinonStub;
    let clipboardStub: sinon.SinonStub;

    beforeEach(() => {
        sandbox = sinon.createSandbox();

        // Logger — silence all output
        sandbox.stub(logger.logger, "info");
        sandbox.stub(logger.logger, "error");
        sandbox.stub(logger.logger, "debug");
        sandbox.stub(logger.logger, "warn");
        sandbox.stub(logger.logger, "show");

        // VS Code UI
        showErrorStub = sandbox.stub(vscode.window, "showErrorMessage");
        showWarningStub = sandbox.stub(vscode.window, "showWarningMessage");
        showInfoStub = sandbox.stub(vscode.window, "showInformationMessage");
        openExternalStub = sandbox.stub(vscode.env, "openExternal");
        clipboardStub = sinon.stub().resolves();
        sandbox.stub(vscode.env, "clipboard").value({ writeText: clipboardStub, readText: sinon.stub().resolves("") });

        // Default: withProgress just invokes the callback immediately
        sandbox.stub(vscode.window, "withProgress").callsFake((_opts, fn) => {
            return fn({ report: () => {} }, new vscode.CancellationTokenSource().token);
        });

        // Octokit mock
        mockOctokit = makeMockOctokit();
        sandbox
            .stub(oidcSetup, "createOctokitClient")
            .returns(mockOctokit as unknown as ReturnType<typeof oidcSetup.createOctokitClient>);
    });

    afterEach(() => {
        sandbox.restore();
    });

    // ── Auth phase ─────────────────────────────────────────────────────────────

    describe("auth phase", () => {
        it("shows error suggesting GitHub extension when auth provider throws", async () => {
            sandbox.stub(vscode.authentication, "getSession").rejects(new Error("No provider"));

            const result = await oidcSetup.setGitHubActionsSecrets("owner", "repo", { SECRET: "val" });

            assert.strictEqual(result, false);
            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes("GitHub extension"));
            assert.ok(mockOctokit.repos.get.notCalled);
        });
    });

    // ── Repo access check phase (repos.get) ────────────────────────────────────

    describe("repo access check", () => {
        beforeEach(() => {
            sandbox.stub(vscode.authentication, "getSession").resolves({
                accessToken: "ghp_test",
            } as vscode.AuthenticationSession);
        });

        it("shows error on 401 (invalid/expired token)", async () => {
            mockOctokit.repos.get.rejects(makeOctokitError(401));

            const result = await oidcSetup.setGitHubActionsSecrets("owner", "repo", { S: "v" });

            assert.strictEqual(result, false);
            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes("invalid or expired"));
        });

        it("shows SSO authorization prompt on 403 with SSO header", async () => {
            mockOctokit.repos.get.rejects(makeOctokitError(403, { ssoUrl: SSO_URL }));
            showErrorStub.resolves("Authorize Token");

            const result = await oidcSetup.setGitHubActionsSecrets("owner", "repo", { S: "v" });

            assert.strictEqual(result, false);
            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes("SAML SSO"));
            // Verify "Authorize Token" button was offered
            assert.ok(showErrorStub.firstCall.args.includes("Authorize Token"));
            assert.ok(openExternalStub.calledOnce);
        });

        it("shows permissions error on 403 without SSO header", async () => {
            mockOctokit.repos.get.rejects(makeOctokitError(403));
            showErrorStub.resolves(undefined); // user dismisses dialog

            const result = await oidcSetup.setGitHubActionsSecrets("owner", "repo", { S: "v" });

            assert.strictEqual(result, false);
            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes("permission"));
        });

        it("shows not-found error on 404", async () => {
            mockOctokit.repos.get.rejects(makeOctokitError(404));

            const result = await oidcSetup.setGitHubActionsSecrets("owner", "repo", { S: "v" });

            assert.strictEqual(result, false);
            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes("not found"));
        });

        it("shows network error on non-HTTP failure", async () => {
            mockOctokit.repos.get.rejects(new Error("getaddrinfo ENOTFOUND"));

            const result = await oidcSetup.setGitHubActionsSecrets("owner", "repo", { S: "v" });

            assert.strictEqual(result, false);
            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes("internet connection"));
        });

        it("shows error when repo is archived", async () => {
            mockOctokit.repos.get.resolves({
                data: { archived: true, permissions: { admin: true, push: true } },
            });

            const result = await oidcSetup.setGitHubActionsSecrets("owner", "repo", { S: "v" });

            assert.strictEqual(result, false);
            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes("archived"));
            assert.ok(mockOctokit.actions.getRepoPublicKey.notCalled, "should not proceed to secret-setting");
        });

        it("shows error and returns when user lacks write access", async () => {
            mockOctokit.repos.get.resolves({
                data: { archived: false, permissions: { admin: false, push: false } },
            });
            showErrorStub.resolves(undefined);

            const result = await oidcSetup.setGitHubActionsSecrets("owner", "repo", { S: "v" });

            assert.strictEqual(result, false);
            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes("write access"));
            assert.ok(mockOctokit.actions.getRepoPublicKey.notCalled);
        });

        it("copies secrets to clipboard when user clicks Copy Secrets on error", async () => {
            mockOctokit.repos.get.rejects(makeOctokitError(404));
            showErrorStub.resolves("Copy Secrets");

            const result = await oidcSetup.setGitHubActionsSecrets("owner", "repo", {
                AZURE_CLIENT_ID: "cid-123",
                AZURE_TENANT_ID: "tid-456",
            });

            assert.strictEqual(result, false);
            assert.ok(clipboardStub.calledOnce);
            const copied = clipboardStub.firstCall.args[0] as string;
            assert.ok(copied.includes("AZURE_CLIENT_ID: cid-123"));
            assert.ok(copied.includes("AZURE_TENANT_ID: tid-456"));
        });
    });

    // ── Secret-setting phase ───────────────────────────────────────────────────

    describe("secret-setting phase", () => {
        /** Libsodium keypair used for realistic encryption in tests. */
        let testPublicKeyBase64: string;

        before(async () => {
            await sodium.ready;
            const keypair = sodium.crypto_box_keypair();
            testPublicKeyBase64 = sodium.to_base64(keypair.publicKey, sodium.base64_variants.ORIGINAL);
        });

        beforeEach(() => {
            sandbox.stub(vscode.authentication, "getSession").resolves({
                accessToken: "ghp_test",
            } as vscode.AuthenticationSession);

            // Default: repos.get passes (non-archived, has push)
            mockOctokit.repos.get.resolves({
                data: { archived: false, permissions: { admin: false, push: true } },
            });
        });

        it("shows admin-access error on getRepoPublicKey 403 without SSO", async () => {
            mockOctokit.actions.getRepoPublicKey.rejects(makeOctokitError(403));

            const result = await oidcSetup.setGitHubActionsSecrets("owner", "repo", { S: "v" });

            assert.strictEqual(result, false);
            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes("admin access"));
        });

        it("shows SSO prompt on getRepoPublicKey 403 with SSO header", async () => {
            mockOctokit.actions.getRepoPublicKey.rejects(makeOctokitError(403, { ssoUrl: SSO_URL }));
            showErrorStub.resolves("Authorize Token");

            const result = await oidcSetup.setGitHubActionsSecrets("owner", "repo", { S: "v" });

            assert.strictEqual(result, false);
            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes("SAML SSO"));
            assert.ok(openExternalStub.calledOnce);
        });

        it("shows connection error on getRepoPublicKey non-403 failure", async () => {
            mockOctokit.actions.getRepoPublicKey.rejects(makeOctokitError(500));

            const result = await oidcSetup.setGitHubActionsSecrets("owner", "repo", { S: "v" });

            assert.strictEqual(result, false);
            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes("encryption key"));
        });

        it("sets all secrets successfully and shows success message", async () => {
            mockOctokit.actions.getRepoPublicKey.resolves({
                data: { key: testPublicKeyBase64, key_id: "key-123" },
            });
            mockOctokit.actions.createOrUpdateRepoSecret.resolves({});

            const secrets = { AZURE_CLIENT_ID: "cid", AZURE_TENANT_ID: "tid" };
            const result = await oidcSetup.setGitHubActionsSecrets("owner", "repo", secrets);

            assert.strictEqual(result, true);
            assert.strictEqual(mockOctokit.actions.createOrUpdateRepoSecret.callCount, 2);
            assert.ok(showInfoStub.calledOnce);
            assert.ok(showInfoStub.firstCall.args[0].includes("successfully"));
        });

        it("shows partial-failure warning and returns false when some secrets fail", async () => {
            mockOctokit.actions.getRepoPublicKey.resolves({
                data: { key: testPublicKeyBase64, key_id: "key-123" },
            });
            // First secret succeeds, second fails
            mockOctokit.actions.createOrUpdateRepoSecret
                .onFirstCall()
                .resolves({})
                .onSecondCall()
                .rejects(new Error("rate limited"));

            const secrets = { AZURE_CLIENT_ID: "cid", AZURE_TENANT_ID: "tid" };
            const result = await oidcSetup.setGitHubActionsSecrets("owner", "repo", secrets);

            assert.strictEqual(result, false);
            assert.ok(showWarningStub.calledOnce);
            assert.ok(showWarningStub.firstCall.args[0].includes("1/2"));
            assert.ok(showWarningStub.firstCall.args[0].includes("AZURE_TENANT_ID"));
        });

        it("shows error and returns false when all secrets fail", async () => {
            mockOctokit.actions.getRepoPublicKey.resolves({
                data: { key: testPublicKeyBase64, key_id: "key-123" },
            });
            mockOctokit.actions.createOrUpdateRepoSecret.rejects(new Error("forbidden"));

            const secrets = { AZURE_CLIENT_ID: "cid", AZURE_TENANT_ID: "tid" };
            const result = await oidcSetup.setGitHubActionsSecrets("owner", "repo", secrets);

            assert.strictEqual(result, false);
            assert.ok(showErrorStub.calledOnce);
            assert.ok(showErrorStub.firstCall.args[0].includes("Failed to set any secrets"));
        });
    });
});

// ─── Pure function tests ───────────────────────────────────────────────────────

describe("isOctokitError", () => {
    it("returns true for object with numeric status", () => {
        assert.strictEqual(oidcSetup.isOctokitError({ status: 404, message: "Not Found" }), true);
    });

    it("returns false for null", () => {
        assert.strictEqual(oidcSetup.isOctokitError(null), false);
    });

    it("returns false for plain Error without status", () => {
        assert.strictEqual(oidcSetup.isOctokitError(new Error("boom")), false);
    });

    it("returns false for object with non-numeric status", () => {
        assert.strictEqual(oidcSetup.isOctokitError({ status: "404" }), false);
    });
});

describe("getSAMLSSOUrl", () => {
    it("extracts URL from valid X-GitHub-SSO header", () => {
        const error = makeOctokitError(403, { ssoUrl: SSO_URL });
        assert.strictEqual(oidcSetup.getSAMLSSOUrl(error), SSO_URL);
    });

    it("returns undefined when header uses non-required directive", () => {
        const error = {
            status: 403,
            message: "Forbidden",
            response: { headers: { "x-github-sso": "partial-results; organizations=123" } },
        };
        assert.strictEqual(oidcSetup.getSAMLSSOUrl(error), undefined);
    });

    it("returns undefined when error has no response", () => {
        assert.strictEqual(oidcSetup.getSAMLSSOUrl(new Error("network")), undefined);
    });
});

describe("encryptSecret", () => {
    it("produces valid base64 output using real libsodium", async () => {
        await sodium.ready;

        const keypair = sodium.crypto_box_keypair();
        const publicKeyBase64 = sodium.to_base64(keypair.publicKey, sodium.base64_variants.ORIGINAL);

        const encrypted = oidcSetup.encryptSecret(publicKeyBase64, "my-secret-value");

        // Verify it's valid base64 by round-tripping
        const decoded = sodium.from_base64(encrypted, sodium.base64_variants.ORIGINAL);
        assert.ok(decoded.length > 0, "encrypted output should decode to non-empty bytes");
        // Sealed box output = message length + crypto_box_SEALBYTES (48)
        const expectedLen = sodium.from_string("my-secret-value").length + sodium.crypto_box_SEALBYTES;
        assert.strictEqual(decoded.length, expectedLen);
    });
});
