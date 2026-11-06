import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSimklUrl,
  createPostQueue,
  errorDetail,
  hasNotFound,
  parseResolvedStatus,
  parseSimklSearch,
  parseSimklUser,
  pkceChallenge,
  simklAuthorizeUrl,
  simklUserAgent,
  withResolvedStatus,
  type PostQueueState,
} from "@/lib/simkl-core";

describe("PKCE", () => {
  it("derives the RFC 7636 example challenge", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("builds the authorize URL on simkl.com with S256 and both scopes", () => {
    const url = new URL(
      simklAuthorizeUrl({ clientId: "cid", redirectUri: "https://x.test/cb", state: "st", verifier: "v".repeat(64) }),
    );
    expect(url.origin + url.pathname).toBe("https://simkl.com/oauth2/authorize");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge("v".repeat(64)));
    expect(url.searchParams.get("scope")).toBe("media:read media:write");
    expect(url.searchParams.get("redirect_uri")).toBe("https://x.test/cb");
  });
});

describe("request URLs", () => {
  it("always adds client_id, app-name and app-version", () => {
    const url = new URL(buildSimklUrl("/sync/all-items", "cid", { next_watch_info: "yes" }, "1.2.3"));
    expect(url.origin + url.pathname).toBe("https://api.simkl.com/sync/all-items");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("app-name")).toBe("anisync");
    expect(url.searchParams.get("app-version")).toBe("1.2.3");
    expect(url.searchParams.get("next_watch_info")).toBe("yes");
    expect(simklUserAgent("1.2.3")).toBe("anisync/1.2.3");
  });
});

describe("response parsing", () => {
  it("reads the resolved status, string or numeric", () => {
    const body = (status: string | number) => ({ added: { statuses: [{ response: { status } }] } });
    expect(parseResolvedStatus(body("watching"))).toBe("watching");
    expect(parseResolvedStatus(body(5))).toBe("on_hold");
    expect(parseResolvedStatus(body("nope"))).toBeNull();
    expect(parseResolvedStatus({ added: { movies: 1 } })).toBeNull();
  });

  it("keeps rewatching when Simkl answers watching", () => {
    const expected = { status: "rewatching" as const, progress: 3 };
    expect(withResolvedStatus(expected, "watching")).toBe(expected);
    expect(withResolvedStatus({ status: "completed" as const }, "watching").status).toBe("watching");
    expect(withResolvedStatus(expected, null)).toBe(expected);
  });

  it("detects not_found items", () => {
    expect(hasNotFound({ not_found: { movies: [], shows: [{ ids: {} }] } })).toBe(true);
    expect(hasNotFound({ not_found: { movies: [], shows: [] } })).toBe(false);
    expect(hasNotFound({})).toBe(false);
  });

  it("parses the user settings and error bodies", () => {
    expect(parseSimklUser({ user: { name: "me", avatar: "https://a/b.jpg" }, account: { id: 12 } })).toEqual({
      id: "12",
      name: "me",
      avatar: "https://a/b.jpg",
    });
    expect(parseSimklUser({})).toBeNull();
    expect(errorDetail({ error: "invalid_grant", error_description: "PKCE verification failed" })).toBe(
      "invalid_grant: PKCE verification failed",
    );
    expect(errorDetail("nope")).toBe("");
  });

  it("parses search results and skips malformed items", () => {
    const json = [
      { title: "Breaking Bad", year: 2008, poster: "97/978343d5161a724", ep_count: 62, ids: { simkl_id: 11121 } },
      { title: "No id", ids: {} },
      { title: "John Wick", year: 2014, poster: null, ids: { simkl_id: 342994 } },
    ];
    expect(parseSimklSearch(json, "show")).toEqual([
      {
        simklId: 11121,
        title: "Breaking Bad",
        year: 2008,
        cover: "https://wsrv.nl/?url=https://simkl.in/posters/97/978343d5161a724_m.webp&q=90",
        totalEpisodes: 62,
      },
      { simklId: 342994, title: "John Wick", year: 2014, cover: null, totalEpisodes: null },
    ]);
    expect(parseSimklSearch(json, "movie")[1]?.totalEpisodes).toBe(1);
    expect(parseSimklSearch({ nope: true }, "show")).toEqual([]);
  });
});

describe("POST queue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs tasks one at a time, at least 1100 ms apart", async () => {
    const state: PostQueueState = { chain: Promise.resolve(), lastDoneAt: 0 };
    const queue = createPostQueue(state);
    const starts: number[] = [];
    const task = async () => {
      starts.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 100));
    };
    vi.setSystemTime(10_000);
    const all = Promise.all([queue.run(task), queue.run(task), queue.run(task)]);
    await vi.runAllTimersAsync();
    await all;
    expect(starts).toHaveLength(3);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1100 + 100);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(1100 + 100);
  });

  it("keeps going after a failed task", async () => {
    const state: PostQueueState = { chain: Promise.resolve(), lastDoneAt: 0 };
    const queue = createPostQueue(state);
    const failing = queue.run(() => Promise.reject(new Error("boom")));
    const next = queue.run(() => Promise.resolve("ok"));
    const failed = expect(failing).rejects.toThrow("boom");
    await vi.runAllTimersAsync();
    await failed;
    await expect(next).resolves.toBe("ok");
  });
});
