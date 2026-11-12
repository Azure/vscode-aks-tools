import * as assert from "assert";
import {
    escapeRegExp,
    getCaptureFromCommand,
    getCaptureFromFilePath,
    getTcpDumpPodCommand,
    isValidCaptureIdentifier,
} from "../../panels/utilities/TcpDumpCommand";

describe("testEscapeRegExp", () => {
    it("should escape special regex characters", () => {
        const input = "a.b*c?d+e^f$g|h(i)j{k}l[m]n\\o";
        const expected = "a\\.b\\*c\\?d\\+e\\^f\\$g\\|h\\(i\\)j\\{k\\}l\\[m\\]n\\\\o";
        const escapedInput = escapeRegExp(input);
        assert.equal(escapedInput, expected);
    });

    it("should not double escape already escaped characters", () => {
        const input = "a\\.b\\*c\\?d\\+e\\^f\\$g\\|h\\(i\\)j\\{k\\}l\\[m\\]n\\\\o";
        const expected = "a\\.b\\*c\\?d\\+e\\^f\\$g\\|h\\(i\\)j\\{k\\}l\\[m\\]n\\\\o";
        const escapedInput = escapeRegExp(input);
        assert.equal(escapedInput, expected);
    });

    it("should return an empty string if input is empty", () => {
        const input = "";
        const expected = "";
        const escapedInput = escapeRegExp(input);
        assert.equal(escapedInput, expected);
    });

    it("should return the same string if no special characters", () => {
        const input = "abcdefg";
        const expected = "abcdefg";
        const escapedInput = escapeRegExp(input);
        assert.equal(escapedInput, expected);
    });
});

describe("TCP dump command boundaries", () => {
    it("accepts only shell-safe capture identifiers", () => {
        for (const value of ["2026-09-30_14-22-01", "capture-1", "capture_test", "A1"]) {
            assert.ok(isValidCaptureIdentifier(value));
        }
        for (const value of ["", "../capture", "capture/name", "capture name", "x;whoami", "x$(whoami)"]) {
            assert.ok(!isValidCaptureIdentifier(value), value);
        }
    });

    it("extracts only complete, valid capture paths", () => {
        assert.strictEqual(getCaptureFromFilePath("/tmp/vscodenodecap_capture-1.cap"), "capture-1");
        assert.strictEqual(getCaptureFromFilePath("/tmp/vscodenodecap_capture-1.cap.extra"), null);
        assert.strictEqual(getCaptureFromFilePath("/tmp/vscodenodecap_x;whoami.cap"), null);
        assert.strictEqual(
            getCaptureFromCommand(
                "tcpdump",
                "tcpdump --snapshot-length=0 -vvv -w /tmp/vscodenodecap_capture-1.cap tcp port 443",
            ),
            "capture-1",
        );
    });

    it("passes the capture script to the pod's shell as one argument, with values quoted", () => {
        const interfaceName = "eth0$(touch /tmp/interface-pwned)";
        const pcapFilter = "tcp[13] & 2 != 0; touch /tmp/filter-pwned";
        const command = getTcpDumpPodCommand("capture-1", {
            interface: interfaceName,
            pcapFilterString: pcapFilter,
        });

        assert.deepStrictEqual(command.slice(0, 2), ["/bin/sh", "-c"]);
        assert.strictEqual(command.length, 3, "the script must not be split into separate arguments");
        assert.strictEqual(
            command[2],
            `tcpdump --snapshot-length=0 -vvv -i '${interfaceName}' -w '/tmp/vscodenodecap_capture-1.cap' '${pcapFilter}' 1>/dev/null 2>&1 &`,
        );
    });

    it("escapes single quotes for the pod's shell", () => {
        const command = getTcpDumpPodCommand("capture-1", { interface: "a'b", pcapFilterString: null });
        assert.ok(command[2].includes(`-i 'a'"'"'b'`), command[2]);
    });

    it("rejects NUL, which cannot be represented in a process argument", () => {
        assert.throws(() => getTcpDumpPodCommand("capture-1", { interface: "eth0\0evil", pcapFilterString: null }));
    });
});
