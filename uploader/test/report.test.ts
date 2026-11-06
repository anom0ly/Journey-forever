import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanReport } from "../../website/src/lib/errorReport";
import { isSecurity, Reporter, scrub } from "../src/report";
import { Store } from "../src/store";

const PRIVATE = {
  home: "C:\\Users\\Justin Smith",
  user: "Justin Smith",
  computer: "JUSTIN-PC",
  account: "Kaelra#2210",
  forever: "D:\\Games\\World of Warcraft\\_forever_",
  characters: ["Adom"],
};

function setup(enabled = true) {
  const store = new Store("https://jf.example", mkdtempSync(join(tmpdir(), "jf-report-")));
  const sent: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  let status = 200;
  const send = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  const reporter = new Reporter(store, { key: () => "jfu_key", enabled: () => enabled, private: () => PRIVATE, send });
  return { store, reporter, sent, fail: () => (status = 500) };
}

describe("error reports from the uploader", () => {
  it("takes out names, the PC and the user's folders", () => {
    const text = scrub(
      "EPERM: open 'C:\\Users\\Justin Smith\\AppData\\Local\\JourneyForever\\state.json' on JUSTIN-PC for Kaelra#2210 (Kaelra), " +
        "D:\\Games\\World of Warcraft\\_forever_\\WTF\\Account\\KAELRA\\SavedVariables\\RoadToSixty.lua, Adom died, Justin Smith; other#1234",
      PRIVATE,
    );
    expect(text).toBe(
      "EPERM: open '%USERPROFILE%\\AppData\\Local\\JourneyForever\\state.json' on <pc> for <battletag> (<account>), " +
        "<WoW>\\WTF\\Account\\<account>\\SavedVariables\\RoadToSixty.lua, <character> died, <user>; <battletag>",
    );
    expect(scrub("C:/Users/Someone Else/x", {})).toBe("%USERPROFILE%/x");
    expect(scrub("Adomant", { characters: ["Adom"] })).toBe("<character>ant"); // names are swapped wherever they appear
  });

  it("spots downloads that weren't what they should be", () => {
    expect(isSecurity("The download didn't match GitHub's checksum")).toBe(true);
    expect(isSecurity("Unexpected file in the addon zip: x.exe")).toBe(true);
    expect(isSecurity("Download failed (503)")).toBe(false);
  });

  it("sends a clean report the site accepts, once a day per problem", async () => {
    const { reporter, sent, store } = setup();
    expect(await reporter.report({ area: "read", file: "RoadToSixty.lua", message: 'unexpected "Adom" (line 4120)' })).toBe(true);
    expect(await reporter.report({ area: "read", file: "RoadToSixty.lua", message: 'unexpected "Adom" (line 4120)' })).toBe(false);
    expect(await reporter.report({ area: "upload", message: "Site answered 500" })).toBe(true);
    expect(sent).toHaveLength(2);
    const r = sent[0];
    expect(r.url).toBe("https://jf.example/api/errors");
    expect(r.headers.get("authorization")).toBe("Bearer jfu_key");
    expect(r.headers.get("x-journey-forever")).toBe("1");
    expect(r.body).toMatchObject({ kind: "uploader", area: "read", file: "RoadToSixty.lua", line: 4120, message: 'unexpected "<character>"' });
    expect(r.body.pc).toMatch(/^pc_[0-9a-f]{8}$/);
    expect(store.config.pcId).toBe(r.body.pc as string);
    expect(cleanReport(r.body)).toMatchObject({ kind: "uploader", area: "read", line: 4120, pc: r.body.pc });
  });

  it("sends nothing when reports are off, and tries again when the site didn't take it", async () => {
    const off = setup(false);
    expect(await off.reporter.report({ area: "crash", message: "x" })).toBe(false);
    expect(off.sent).toHaveLength(0);
    const down = setup();
    down.fail();
    expect(await down.reporter.report({ area: "crash", message: "x" })).toBe(false);
    expect(await down.reporter.report({ area: "crash", message: "x" })).toBe(false);
    expect(down.sent).toHaveLength(2);
  });

  it("reports a crash on the next start", async () => {
    const { reporter, sent, store } = setup();
    Reporter.saveCrash(store.dir, new TypeError("boom at C:\\Users\\Justin Smith\\x"));
    await reporter.sendCrash();
    expect(existsSync(join(store.dir, "crash.json"))).toBe(false);
    expect(sent[0].body).toMatchObject({ area: "crash", message: "TypeError: boom at %USERPROFILE%\\x" });
    await reporter.sendCrash();
    expect(sent).toHaveLength(1);
  });
});
