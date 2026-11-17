import { afterEach, describe, expect, it, vi } from "vitest";
import { send } from "../src/lib/send";

const noWait = async () => undefined;

describe("requests that get no answer", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends a save again when the connection drops, then succeeds", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(new Response("{}"));
    const res = await send("/api/characters/x/boards", { method: "PUT", body: "{}" }, noWait);
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("gives up after two more tries", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(send("/api/characters/x/journey", { method: "PUT" }, noWait)).rejects.toBeInstanceOf(TypeError);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("never repeats a POST, or a request the server answered", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(send("/api/public/x/report", { method: "POST" }, noWait)).rejects.toBeInstanceOf(TypeError);
    expect(f).toHaveBeenCalledTimes(1);
    f.mockReset().mockResolvedValue(new Response("{}", { status: 500 }));
    expect((await send("/api/characters/x", { method: "PUT" }, noWait)).status).toBe(500);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
