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

    it("keeps interface and pcap syntax out of the local shell command", () => {
        const interfaceName = "eth0$(touch /tmp/interface-pwned)";
        const pcapFilter = "tcp[13] & 2 != 0; touch /tmp/filter-pwned";
        const command = getTcpDumpPodCommand("capture-1", {
            interface: interfaceName,
            pcapFilterString: pcapFilter,
        });

        assert.ok(!command.includes(interfaceName));
        assert.ok(!command.includes(pcapFilter));
        const encoded = command.match(/'([A-Za-z0-9+/=]+)'/)?.[1];
        assert.ok(encoded);
        const decoded = Buffer.from(encoded, "base64").toString("utf8");
        assert.ok(decoded.includes(`'${interfaceName}'`));
        assert.ok(decoded.includes(`'${pcapFilter}'`));
    });

    it("rejects NUL, which cannot be represented in a process argument", () => {
        assert.throws(() => getTcpDumpPodCommand("capture-1", { interface: "eth0\0evil", pcapFilterString: null }));
    });
});
