import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanReport, headline, redact, REPORT_FILES, routeOf, splitLine } from "../src/lib/errorReport";
import { SAVED_FILES } from "../src/lib/parse/upload";
import { handleErrorReport } from "../src/worker/errors";
import { HttpError } from "../src/worker/http";

describe("error reports", () => {
  it("never keeps quoted text from a saved file", () => {
    expect(redact('unexpected "Brannoc"')).toBe('unexpected "…"');
    expect(redact('bad number "12x"')).toBe('bad number "…"');
    expect(redact('expected "," or "}"')).toBe('expected "," or "}"');
    expect(redact('unexpected "end of file"')).toBe('unexpected "end of file"');
  });

  it("keeps the parser's line apart from its message", () => {
    expect(splitLine('expected "=" (line 42)')).toEqual({ message: 'expected "="', line: 42 });
    expect(splitLine("No journey data in this file.")).toEqual({ message: "No journey data in this file." });
  });

  it("takes names out of page paths", () => {
    expect(routeOf("/c/Brannoc-SampleRealm/stats")).toBe("/c/:id/stats");
    expect(routeOf("/j/brannoc-samplerealm")).toBe("/j/:id");
    expect(routeOf("/compare/a-b/c-d")).toBe("/compare/:id/:id");
    expect(routeOf("/leaderboards/board/zone-first/Elwynn Forest")).toBe("/leaderboards/board/zone-first/:param");
    expect(routeOf("/upload")).toBe("/upload");
  });

  it("checks every field and drops what it doesn't know", () => {
    expect(cleanReport(null)).toBeNull();
    expect(cleanReport({ kind: "nope", message: "x" })).toBeNull();
    expect(cleanReport({ kind: "crash" })).toBeNull();
    const r = cleanReport({
      kind: "upload", step: "read", file: "RoadToSixty.lua", size: 1234, line: 7, message: 'unexpected "Brannoc"',
      route: "/c/Brannoc-Realm", battletag: "Someone#1234", text: "RoadToSixtyCharDB = {...}",
    });
    expect(r).toEqual({ kind: "upload", step: "read", file: "RoadToSixty.lua", size: 1234, line: 7, message: 'unexpected "…"', route: "/c/:id" });
    expect(cleanReport({ kind: "upload", message: "x", file: "C:\\WTF\\Account\\NAME\\Other.lua", size: -1, step: "x" })).toEqual({ kind: "upload", message: "x" });
    expect(cleanReport({ kind: "crash", message: "x".repeat(5000) })!.message).toHaveLength(300);
  });

  it("names the same files as the upload reader", () => {
    expect(REPORT_FILES).toEqual(SAVED_FILES);
  });

  it("titles a report by where it happened", () => {
    expect(headline({ kind: "upload", step: "read", file: "JourneyTracker.lua", message: "bad" })).toBe("Browser upload read JourneyTracker.lua: bad");
    expect(headline({ kind: "render", message: "TypeError: x is undefined" })).toBe("Browser render: TypeError: x is undefined");
  });
});

describe("POST /api/errors", () => {
  afterEach(() => vi.restoreAllMocks());
  const post = (body: string) => new Request("https://example.com/api/errors", { method: "POST", body });

  it("logs a cleaned report as an error", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await handleErrorReport(post(JSON.stringify({ kind: "crash", message: 'TypeError: "Brannoc" is not a function', stack: "at x (/assets/a.js:1:2)" })), "u1");
    expect(res.status).toBe(200);
    const [err, details] = log.mock.calls[0];
    expect((err as Error).name).toBe("BrowserError");
    expect((err as Error).message).toBe('Browser crash: TypeError: "…" is not a function');
    expect((err as Error).stack).toContain("/assets/a.js:1:2");
    expect(JSON.parse(details as string)).toEqual({ source: "browser", kind: "crash", message: 'TypeError: "…" is not a function', userId: "u1" });
  });

  it("refuses what isn't a report", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(handleErrorReport(post("not json"), null)).rejects.toBeInstanceOf(HttpError);
    await expect(handleErrorReport(post(JSON.stringify({ kind: "crash" })), null)).rejects.toBeInstanceOf(HttpError);
    await expect(handleErrorReport(post(JSON.stringify({ kind: "crash", message: "x".repeat(5000) })), null)).rejects.toMatchObject({ status: 413 });
  });
});
