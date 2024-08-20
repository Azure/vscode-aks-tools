import * as assert from "assert";
import { escapeRegExp } from "../../panels/TcpDumpPanel";

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
