import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { enableCrossTabInvalidation } from "./query-client";

/**
 * One fake BroadcastChannel per channel name, shared by every "tab" in the
 * test: messages posted by one instance reach the others (not the poster),
 * exactly like the real API.
 */
class FakeBroadcastChannel {
  static byName = new Map<string, FakeBroadcastChannel[]>();
  name: string;
  handlers: Array<(e: { data: unknown }) => void> = [];
  posted: unknown[] = [];
  constructor(name: string) {
    this.name = name;
    const list = FakeBroadcastChannel.byName.get(name) ?? [];
    list.push(this);
    FakeBroadcastChannel.byName.set(name, list);
  }
  addEventListener(_type: string, fn: (e: { data: unknown }) => void) {
    this.handlers.push(fn);
  }
  postMessage(data: unknown) {
    this.posted.push(data);
    for (const peer of FakeBroadcastChannel.byName.get(this.name) ?? []) {
      if (peer === this) continue;
      for (const h of peer.handlers) h({ data });
    }
  }
  close() {
    const list = FakeBroadcastChannel.byName.get(this.name) ?? [];
    const i = list.indexOf(this);
    if (i >= 0) list.splice(i, 1);
  }
}

const tabClient = () =>
  new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } } });

describe("cross-tab query invalidation (lib/query-client.ts)", () => {
  const realBC = globalThis.BroadcastChannel;
  beforeEach(() => {
    FakeBroadcastChannel.byName = new Map();
    (globalThis as Record<string, unknown>).BroadcastChannel = FakeBroadcastChannel;
  });
  afterEach(() => {
    (globalThis as Record<string, unknown>).BroadcastChannel = realBC;
  });

  async function seeded(key: string[]) {
    const client = tabClient();
    client.setQueryData(key, { v: 1 });
    enableCrossTabInvalidation(client);
    return client;
  }
  const channels = () => FakeBroadcastChannel.byName.get("investwise-query-invalidation") ?? [];

  it("invalidating in one tab marks the same key stale in every other tab", async () => {
    const a = await seeded(["projects"]);
    const b = await seeded(["projects", "member-binding"]);
    const spy = vi.spyOn(b, "invalidateQueries");

    await a.invalidateQueries({ queryKey: ["projects"] });

    // Prefix match: the other tab's picker query is invalidated by the write.
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["projects"] }));
    expect(b.getQueryCache().find({ queryKey: ["projects", "member-binding"] })!.state.isInvalidated).toBe(true);
  });

  it("posts the FACT only — never cached data", async () => {
    const a = await seeded(["funds"]);
    await a.invalidateQueries({ queryKey: ["funds"] });
    const messages = channels().flatMap((c) => c.posted) as Array<{ sender: string; queryKeys: unknown }>;
    expect(messages.length).toBe(1);
    expect(messages[0]!.queryKeys).toEqual([["funds"]]);
    expect(Object.keys(messages[0]!)).toEqual(["sender", "queryKeys"]);
  });

  it("a remote invalidation is NOT re-broadcast (no echo loop)", async () => {
    const a = await seeded(["members"]);
    const b = await seeded(["members"]);
    await a.invalidateQueries({ queryKey: ["members"] });
    const totalPosted = channels().reduce((n, c) => n + c.posted.length, 0);
    expect(totalPosted).toBe(1); // exactly the originating tab's message
  });

  it("ignores malformed messages without touching the cache or throwing", async () => {
    const b = await seeded(["projects"]);
    const spy = vi.spyOn(b, "invalidateQueries");
    const inbox = channels().find((c) => c.handlers.length > 0)!.handlers[0]!;
    // Garbage frames a confused (or hostile same-origin) script could post.
    for (const junk of [null, undefined, {}, { sender: "other" }, { sender: "other", queryKeys: "projects" }]) {
      expect(() => inbox({ data: junk })).not.toThrow();
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("a plain refetch/update event is never broadcast — only invalidate", async () => {
    const a = await seeded(["funds"]);
    channels().forEach((c) => (c.posted = [])); // clear the setup noise if any
    a.setQueryData(["funds"], { v: 2 }); // a data update is NOT an invalidation
    const totalPosted = channels().reduce((n, c) => n + c.posted.length, 0);
    expect(totalPosted).toBe(0);
  });
});
