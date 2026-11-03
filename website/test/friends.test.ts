import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addFriends, friendCount, friendHashes, hashTag, jfFriends, rtsFriends, validTag } from "../src/lib/friends";
import { parseSavedVariables } from "../src/lib/lua";
import { readUpload } from "../src/lib/parse/upload";
import { sampleFiles } from "./samples";

describe("friends lists", () => {
  it("reads both addons' lists from the sample account", () => {
    const { friends } = readUpload(sampleFiles(), 1800000000);
    expect(friends.jf?.tags).toEqual(["Thess#1187", "Ros#2210", "Hollin#3301"]);
    expect(friends.rts?.sort()).toEqual(["Ashka#4410", "Thess#1187"]);
    expect(friendCount(friends)).toEqual({ total: 4, jf: 3, rts: 2, both: 1 });
  });

  it("reads the addon's own sample file", () => {
    const text = readFileSync(new URL("../../addon/samples/JourneyForever.lua", import.meta.url), "utf8");
    const { friends } = readUpload([{ path: "ACC/TestRealm/Testchar/SavedVariables/JourneyForever.lua", text }]);
    expect(friends.jf?.tags).toEqual(["Ros#2210", "Thess#1187"]);
    expect(friends.rts).toBeUndefined();
  });

  it("keeps valid, unique tags only", () => {
    const db = parseSavedVariables('X = { friends = { t = 5, tags = { "a#1", "A#1", "nope", "b|c#2", "c#3" } } }').X;
    expect(jfFriends(db)).toEqual({ t: 5, tags: ["a#1", "c#3"] });
    expect(jfFriends({})).toBeUndefined();
    expect(rtsFriends(parseSavedVariables("X = { roster = {} }").X)).toBeUndefined();
    expect(rtsFriends(parseSavedVariables('X = { friends = { k = { name = "N" } } }').X)).toEqual([]);
    expect(validTag("Name#1234")).toBe(true);
    expect(validTag("Name")).toBe(false);
  });

  it("takes the newest addon list across characters", () => {
    const into = {};
    addFriends(into, parseSavedVariables('JourneyForeverDB = { friends = { t = 10, tags = { "new#1" } } }'));
    addFriends(into, parseSavedVariables('JourneyForeverDB = { friends = { t = 5, tags = { "old#1" } } }'));
    expect(into).toEqual({ jf: { t: 10, tags: ["new#1"] } });
  });

  it("hashes tags the same in any case, and sends only hashes", async () => {
    expect(await hashTag("Thess#1187")).toBe(await hashTag(" thess#1187"));
    expect(await hashTag("Thess#1187")).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashTag("Thess#1187")).not.toBe(await hashTag("Thess#1188"));
    const sent = await friendHashes({ rts: ["Thess#1187"] });
    expect(Object.keys(sent)).toEqual(["rts"]);
    expect(JSON.stringify(sent)).not.toContain("Thess");
  });
});
