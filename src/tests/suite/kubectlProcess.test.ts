import * as assert from "assert";
import childProcess, { ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import * as sinon from "sinon";
import { KubectlInvocation, KubectlProcessRunner, MAX_KUBECTL_OUTPUT_BYTES } from "../../commands/utils/kubectlProcess";

function fixture() {
    const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        stdin: new PassThrough(),
        kill: sinon.stub().returns(true),
    });
    child.kill.callsFake(() => {
        setImmediate(() => child.emit("close", null));
        return true;
    });
    return { child, process: child as unknown as ChildProcess };
}

function invocation(args: string[] = []): KubectlInvocation {
    return { executable: process.execPath, args, env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } };
}

describe("AKS one-shot kubectl process runner", () => {
    afterEach(() => sinon.restore());

    it("passes literal arguments and stdin to a real process without a shell", async () => {
        const runner = new KubectlProcessRunner();
        const args = [
            "space value",
            "${env:SECRET}",
            "${command:doNotRun}",
            ";$(marker)",
            'quote"backslash\\',
            "%PATH%",
        ];
        const body = JSON.stringify({ password: "private-token", prompt: "private prompt" });
        const script =
            "let body='';process.stdin.setEncoding('utf8');process.stdin.on('data',s=>body+=s);process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({args:process.argv.slice(1),body}));process.stderr.write('warning');process.exitCode=7;});";
        const spawn = sinon.spy(childProcess, "spawn");
        try {
            const result = await runner.execute(invocation(["-e", script, "--", ...args]), body);

            assert.strictEqual(result.code, 7);
            assert.strictEqual(result.stderr, "warning");
            assert.deepStrictEqual(JSON.parse(result.stdout), { args, body });
            assert.strictEqual(spawn.firstCall.args[2]?.shell, false);
            assert.ok(!JSON.stringify(spawn.firstCall.args[1]).includes("private-token"));
        } finally {
            runner.dispose();
        }
    });

    it("closes stdin even when no input was supplied", async () => {
        const runner = new KubectlProcessRunner();
        try {
            const result = await runner.execute(
                invocation(["-e", "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('EOF')); "]),
            );

            assert.deepStrictEqual(result, { code: 0, stdout: "EOF", stderr: "" });
        } finally {
            runner.dispose();
        }
    });

    it("preserves source exit status and separate stderr through a real stdout pipe", async function () {
        if (process.platform === "win32") this.skip();
        const runner = new KubectlProcessRunner();
        try {
            const result = await runner.execute({
                ...invocation([
                    "-e",
                    "process.stdout.write('partial');process.stderr.write('Forbidden');process.exitCode=17;",
                ]),
                pipeTo: { executable: "cat", args: [] },
            });

            assert.deepStrictEqual(result, { code: 17, stdout: "partial", stderr: "Forbidden" });
        } finally {
            runner.dispose();
        }
    });

    it("forgets completed commands instead of retaining children until disposal", async () => {
        const runner = new KubectlProcessRunner();
        const children: ReturnType<typeof fixture>["child"][] = [];
        sinon.stub(childProcess, "spawn").callsFake(() => {
            const { child, process } = fixture();
            children.push(child);
            setImmediate(() => child.emit("close", 0));
            return process;
        });

        for (let count = 0; count < 25; count++) {
            await runner.execute(invocation(["get", "pods"]));
        }
        runner.dispose();

        for (const child of children) {
            sinon.assert.notCalled(child.kill);
            assert.strictEqual(child.listenerCount("close"), 0);
            assert.strictEqual(child.listenerCount("error"), 0);
            assert.strictEqual(child.stdout.listenerCount("data"), 0);
            assert.strictEqual(child.stderr.listenerCount("data"), 0);
        }
    });

    it("cancels active commands on disposal and refuses later launches", async () => {
        const runner = new KubectlProcessRunner();
        const { child, process } = fixture();
        const spawn = sinon.stub(childProcess, "spawn").returns(process);
        const completed = assert.rejects(runner.execute(invocation()), /disposed/);

        runner.dispose();

        await completed;
        sinon.assert.calledOnceWithExactly(child.kill, "SIGKILL");
        await assert.rejects(() => runner.execute(invocation()), /disposed/);
        sinon.assert.calledOnce(spawn);
    });

    it("removes only its own listeners", async () => {
        const runner = new KubectlProcessRunner();
        const { child, process } = fixture();
        const output = sinon.spy();
        const closed = sinon.spy();
        child.stdout.on("data", output);
        child.on("close", closed);
        sinon.stub(childProcess, "spawn").returns(process);
        const pending = runner.execute(invocation());
        child.stdout.write("out");
        child.emit("close", 0);

        await pending;

        assert.ok(child.stdout.listeners("data").includes(output));
        assert.ok(child.listeners("close").includes(closed));
        sinon.assert.calledOnce(output);
        sinon.assert.calledOnce(closed);
        runner.dispose();
    });

    it("keeps independent stdout and stderr limits", async () => {
        const runner = new KubectlProcessRunner();
        const { child, process } = fixture();
        sinon.stub(childProcess, "spawn").returns(process);
        const pending = runner.execute(invocation());
        child.stdout.write(Buffer.alloc(15 * 1024 * 1024, "a"));
        child.stderr.write(Buffer.alloc(6 * 1024 * 1024, "b"));
        child.emit("close", 0);

        const result = await pending;

        assert.strictEqual(result.stdout.length, 15 * 1024 * 1024);
        assert.strictEqual(result.stderr.length, 6 * 1024 * 1024);
        sinon.assert.notCalled(child.kill);
        runner.dispose();
    });

    for (const stream of ["stdout", "stderr"] as const) {
        it(`stops both pipeline processes when ${stream} exceeds its limit`, async () => {
            const runner = new KubectlProcessRunner();
            const source = fixture();
            const sink = fixture();
            const spawn = sinon.stub(childProcess, "spawn");
            spawn.onFirstCall().returns(source.process);
            spawn.onSecondCall().returns(sink.process);
            const pending = assert.rejects(
                runner.execute({
                    ...invocation(),
                    pipeTo: { executable: "cat", args: [] },
                }),
                /exceeded/,
            );

            (stream === "stdout" ? sink.child.stdout : source.child.stderr).write(
                Buffer.alloc(MAX_KUBECTL_OUTPUT_BYTES + 1),
            );

            await pending;
            sinon.assert.calledOnceWithExactly(source.child.kill, "SIGKILL");
            sinon.assert.calledOnceWithExactly(sink.child.kill, "SIGKILL");
            runner.dispose();
        });
    }

    it("cleans up the source when starting the output copier fails", async () => {
        const runner = new KubectlProcessRunner();
        const { child, process } = fixture();
        const spawn = sinon.stub(childProcess, "spawn");
        spawn.onFirstCall().returns(process);
        spawn.onSecondCall().throws(new Error("copier could not be started"));

        await assert.rejects(
            () =>
                runner.execute({
                    ...invocation(),
                    pipeTo: { executable: "cat", args: [] },
                }),
            /copier could not be started/,
        );

        sinon.assert.calledOnceWithExactly(child.kill, "SIGKILL");
        runner.dispose();
    });

    it("stops the source if its output copier fails before kubectl exits", async () => {
        const runner = new KubectlProcessRunner();
        const source = fixture();
        const sink = fixture();
        const spawn = sinon.stub(childProcess, "spawn");
        spawn.onFirstCall().returns(source.process);
        spawn.onSecondCall().returns(sink.process);
        const pending = assert.rejects(
            runner.execute({
                ...invocation(),
                pipeTo: { executable: "cat", args: [] },
            }),
            /output pipe failed with status 9/,
        );

        sink.child.emit("close", 9);

        await pending;
        sinon.assert.calledOnceWithExactly(source.child.kill, "SIGKILL");
        runner.dispose();
    });

    it("keeps the real command result when stdin closes early with EPIPE", async () => {
        const runner = new KubectlProcessRunner();
        const { child, process } = fixture();
        sinon.stub(childProcess, "spawn").returns(process);
        const pending = runner.execute(invocation(), "input");
        child.stdin.emit("error", Object.assign(new Error("closed"), { code: "EPIPE" }));
        child.stderr.write("Forbidden");
        child.emit("close", 7);

        assert.deepStrictEqual(await pending, { code: 7, stdout: "", stderr: "Forbidden" });
        sinon.assert.notCalled(child.kill);
        runner.dispose();
    });

    it("reports other stdin failures and stops the command", async () => {
        const runner = new KubectlProcessRunner();
        const { child, process } = fixture();
        sinon.stub(childProcess, "spawn").returns(process);
        const pending = assert.rejects(runner.execute(invocation(), "input"), /write failed/);

        child.stdin.emit("error", new Error("write failed"));

        await pending;
        sinon.assert.calledOnceWithExactly(child.kill, "SIGKILL");
        runner.dispose();
    });

    it("monitors stderr while the child is still running", async () => {
        const runner = new KubectlProcessRunner();
        const { child, process } = fixture();
        sinon.stub(childProcess, "spawn").returns(process);
        const monitor = { onStderr: sinon.spy(), onExit: sinon.spy() };
        const pending = runner.execute(invocation(), undefined, monitor);

        child.stderr.write("device login instructions");

        sinon.assert.calledOnceWithExactly(monitor.onStderr, "device login instructions");
        sinon.assert.notCalled(monitor.onExit);
        child.emit("close", 0);
        await pending;
        sinon.assert.calledOnceWithExactly(monitor.onExit, 0);
        runner.dispose();
    });
});
