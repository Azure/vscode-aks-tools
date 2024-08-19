import * as assert from "assert";
import { escapeRegExp } from "../../panels/TcpDumpPanel";

describe("testEscapeRegExp", function () {
    it("should escape special regex characters", function () {
        const input = "a.b*c?d+e^f$g|h(i)j{k}l[m]n\\o";
        const expected = "a\\.b\\*c\\?d\\+e\\^f\\$g\\|h\\(i\\)j\\{k\\}l\\[m\\]n\\\\o";
        assert.equal(escapeRegExp(input), expected);
    });

    it("should return the same string if no special characters", function () {
        const input = "abcdefg";
        const expected = "abcdefg";
        assert.equal(escapeRegExp(input), expected);
    });

    it("should return an empty string if input is empty", function () {
        const input = "";
        const expected = "";
        assert.equal(escapeRegExp(input), expected);
    });

    it("should not double escape already escaped characters", function () {
        const input = "a\\.b\\*c\\?d\\+e\\^f\\$g\\|h\\(i\\)j\\{k\\}l\\[m\\]n\\\\o";
        const expected = "a\\.b\\*c\\?d\\+e\\^f\\$g\\|h\\(i\\)j\\{k\\}l\\[m\\]n\\\\o";
        assert.equal("escapeRegExp(input)", expected);
    });
});
