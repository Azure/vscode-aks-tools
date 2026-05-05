import * as assert from "assert";
import { KICKSTART_PARTICIPANT_ID, KICKSTART_SAMPLE_REPO_URL } from "./config";

describe("kickstart config", () => {
    it("KICKSTART_SAMPLE_REPO_URL matches the sample repo URL pattern", () => {
        assert.match(KICKSTART_SAMPLE_REPO_URL, /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/);
    });

    it("KICKSTART_PARTICIPANT_ID uses a publisher-prefixed convention", () => {
        assert.ok(KICKSTART_PARTICIPANT_ID.includes("."));
    });
});
