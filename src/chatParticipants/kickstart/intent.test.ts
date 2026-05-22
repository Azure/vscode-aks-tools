import * as assert from "assert";
import { detectIntentFast, detectIntent } from "./intent";
import { Phase, KickstartState } from "./state";

const state = (phase: Phase): KickstartState => ({
    currentPhase: phase,
    workspaceFolder: "/tmp/ws",
});

describe("detectIntentFast", () => {
    describe("slash commands", () => {
        it("/start from a complete state restarts at ANALYZE", () => {
            const i = detectIntentFast("", "/start", state(Phase.COMPLETE));
            assert.deepStrictEqual(i, { action: "run", phase: Phase.ANALYZE });
        });

        it("/start from a partial state resumes current phase", () => {
            const i = detectIntentFast("", "/start", state(Phase.BUILD));
            assert.deepStrictEqual(i, { action: "run", phase: Phase.BUILD });
        });

        it("/sample triggers ANALYZE", () => {
            const i = detectIntentFast("", "/sample", state(Phase.PREPARE));
            assert.deepStrictEqual(i, { action: "run", phase: Phase.ANALYZE });
        });
    });

    describe("keyword matches", () => {
        it("returns create for create cluster keywords", () => {
            assert.deepStrictEqual(detectIntentFast("create cluster", undefined, state(Phase.ANALYZE)), {
                action: "create",
            });
            assert.deepStrictEqual(detectIntentFast("I want a new cluster", undefined, state(Phase.ANALYZE)), {
                action: "create",
            });
            assert.deepStrictEqual(detectIntentFast("no cluster yet", undefined, state(Phase.ANALYZE)), {
                action: "create",
            });
        });

        it("returns status for status keywords", () => {
            assert.deepStrictEqual(detectIntentFast("what's my status", undefined, state(Phase.ANALYZE)), {
                action: "status",
            });
            assert.deepStrictEqual(detectIntentFast("where am i", undefined, state(Phase.ANALYZE)), {
                action: "status",
            });
        });

        it("returns reset for reset keywords", () => {
            assert.deepStrictEqual(detectIntentFast("start over", undefined, state(Phase.BUILD)), { action: "reset" });
            assert.deepStrictEqual(detectIntentFast("reset", undefined, state(Phase.BUILD)), { action: "reset" });
        });

        it("returns run with current phase for resume keywords", () => {
            assert.deepStrictEqual(detectIntentFast("resume", undefined, state(Phase.BUILD)), {
                action: "run",
                phase: Phase.BUILD,
            });
            assert.deepStrictEqual(detectIntentFast("continue", undefined, state(Phase.DEPLOY)), {
                action: "run",
                phase: Phase.DEPLOY,
            });
        });

        it("returns ANALYZE for analyze keywords", () => {
            assert.deepStrictEqual(detectIntentFast("analyze my project", undefined, state(Phase.BUILD)), {
                action: "run",
                phase: Phase.ANALYZE,
            });
        });

        it("returns CONFIGURE for configure keywords", () => {
            assert.deepStrictEqual(detectIntentFast("configure my cluster", undefined, state(Phase.ANALYZE)), {
                action: "run",
                phase: Phase.CONFIGURE,
            });
        });

        it("returns PREPARE for prepare/generate/dockerfile/manifest keywords", () => {
            assert.deepStrictEqual(detectIntentFast("generate the dockerfile", undefined, state(Phase.ANALYZE)), {
                action: "run",
                phase: Phase.PREPARE,
            });
            assert.deepStrictEqual(detectIntentFast("manifest", undefined, state(Phase.ANALYZE)), {
                action: "run",
                phase: Phase.PREPARE,
            });
        });

        it("returns BUILD for build/push keywords", () => {
            assert.deepStrictEqual(detectIntentFast("build it", undefined, state(Phase.ANALYZE)), {
                action: "run",
                phase: Phase.BUILD,
            });
        });

        it("returns DEPLOY for deploy/ship/apply keywords", () => {
            assert.deepStrictEqual(detectIntentFast("deploy now", undefined, state(Phase.ANALYZE)), {
                action: "run",
                phase: Phase.DEPLOY,
            });
            assert.deepStrictEqual(detectIntentFast("apply", undefined, state(Phase.ANALYZE)), {
                action: "run",
                phase: Phase.DEPLOY,
            });
        });

        it("returns VERIFY for verify/check/health keywords", () => {
            assert.deepStrictEqual(detectIntentFast("verify it works", undefined, state(Phase.ANALYZE)), {
                action: "run",
                phase: Phase.VERIFY,
            });
        });
    });

    describe("ambiguity", () => {
        it("returns undefined for prompts with no keyword match", () => {
            assert.strictEqual(detectIntentFast("hello", undefined, state(Phase.ANALYZE)), undefined);
            assert.strictEqual(
                detectIntentFast("can you help me get this on the cluster", undefined, state(Phase.ANALYZE)),
                undefined,
            );
        });

        it("returns undefined for empty prompt with no command", () => {
            assert.strictEqual(detectIntentFast("", undefined, state(Phase.ANALYZE)), undefined);
        });
    });
});

describe("detectIntent (combined with fallback)", () => {
    it("uses keyword path when keyword matches", async () => {
        const { intent, source } = await detectIntent("deploy", undefined, state(Phase.PREPARE));
        assert.strictEqual(source, "keyword");
        assert.deepStrictEqual(intent, { action: "run", phase: Phase.DEPLOY });
    });

    it("uses default path when no keyword and no LMClient", async () => {
        const { intent, source } = await detectIntent("ambiguous text", undefined, state(Phase.BUILD));
        assert.strictEqual(source, "default");
        assert.deepStrictEqual(intent, { action: "run", phase: Phase.BUILD });
    });

    it("uses LLM path when no keyword and LMClient returns valid JSON", async () => {
        const fakeLM = {
            sendRequest: async () => ({ succeeded: true as const, result: '{"action":"run","phase":4}' }),
        };
        const { intent, source } = await detectIntent("get my thing onto the cluster", undefined, state(Phase.BUILD), {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lmClient: fakeLM as any,
        });
        assert.strictEqual(source, "llm");
        assert.deepStrictEqual(intent, { action: "run", phase: Phase.DEPLOY });
    });

    it("falls back to default when LLM returns invalid JSON", async () => {
        const fakeLM = {
            sendRequest: async () => ({ succeeded: true as const, result: "not json at all" }),
        };
        const { intent, source } = await detectIntent("ambiguous text", undefined, state(Phase.BUILD), {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lmClient: fakeLM as any,
        });
        assert.strictEqual(source, "default");
        assert.deepStrictEqual(intent, { action: "run", phase: Phase.BUILD });
    });

    it("falls back to default when LLM returns invalid action", async () => {
        const fakeLM = {
            sendRequest: async () => ({ succeeded: true as const, result: '{"action":"nuke"}' }),
        };
        const { intent, source } = await detectIntent("ambiguous text", undefined, state(Phase.BUILD), {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lmClient: fakeLM as any,
        });
        assert.strictEqual(source, "default");
        assert.deepStrictEqual(intent, { action: "run", phase: Phase.BUILD });
    });

    it("falls back to default when LLM sendRequest fails", async () => {
        const fakeLM = {
            sendRequest: async () => ({ succeeded: false as const, error: "no model" }),
        };
        const { source } = await detectIntent("ambiguous text", undefined, state(Phase.BUILD), {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lmClient: fakeLM as any,
        });
        assert.strictEqual(source, "default");
    });

    it("extracts JSON from markdown code blocks", async () => {
        const fakeLM = {
            sendRequest: async () => ({
                succeeded: true as const,
                result: '```json\n{"action":"status"}\n```',
            }),
        };
        const { intent, source } = await detectIntent("how am I doing", undefined, state(Phase.BUILD), {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lmClient: fakeLM as any,
        });
        assert.strictEqual(source, "llm");
        assert.deepStrictEqual(intent, { action: "status" });
    });

    it("clamps out-of-range LLM phase to current phase", async () => {
        const fakeLM = {
            sendRequest: async () => ({ succeeded: true as const, result: '{"action":"run","phase":42}' }),
        };
        const { intent } = await detectIntent("ambiguous", undefined, state(Phase.PREPARE), {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lmClient: fakeLM as any,
        });
        assert.deepStrictEqual(intent, { action: "run", phase: Phase.PREPARE });
    });

    it("does not call LLM when prompt is empty", async () => {
        let called = false;
        const fakeLM = {
            sendRequest: async () => {
                called = true;
                return { succeeded: true as const, result: '{"action":"status"}' };
            },
        };
        await detectIntent("", undefined, state(Phase.ANALYZE), {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lmClient: fakeLM as any,
        });
        assert.strictEqual(called, false);
    });
});
