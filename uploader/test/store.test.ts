import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OLD_SITE, Store } from "../src/store";

const NEW = "https://journey.wowhub.net";

test("a PC set up with the old address moves to the new one, keeping its key", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-store-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ site: OLD_SITE, key: "dpapi:abc" }));
  const store = new Store(NEW, dir);
  expect(store.config.site).toBe(NEW);
  expect(store.config.key).toBe("dpapi:abc");
  expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8")).site).toBe(NEW);
});

test("any other address is left alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "jf-store-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ site: "http://localhost:8787" }));
  expect(new Store(NEW, dir).config.site).toBe("http://localhost:8787");
});

test("a new PC gets the default", () => {
  expect(new Store(NEW, mkdtempSync(join(tmpdir(), "jf-store-"))).config.site).toBe(NEW);
});
