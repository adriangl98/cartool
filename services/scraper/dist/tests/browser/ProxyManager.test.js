"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ProxyManager_1 = require("../../src/browser/ProxyManager");
// ---------------------------------------------------------------------------
// Mock Redis — lightweight in-memory implementation of the commands used by
// ProxyManager: exists, set, incr, del
// ---------------------------------------------------------------------------
class MockRedis {
    store = new Map();
    async exists(key) {
        return this.store.has(key) ? 1 : 0;
    }
    async set(key, value, _ex, _ttl) {
        this.store.set(key, value);
        return "OK";
    }
    async incr(key) {
        const current = Number(this.store.get(key) ?? "0");
        const next = current + 1;
        this.store.set(key, String(next));
        return next;
    }
    async del(key) {
        return this.store.delete(key) ? 1 : 0;
    }
    /** Test helper: clear all keys. */
    clear() {
        this.store.clear();
    }
    /** Test helper: inspect stored keys. */
    keys() {
        return [...this.store.keys()];
    }
}
// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const THREE_PROXIES = [
    "proxy1.example.com:8080:user1:pass1",
    "proxy2.example.com:8081:user2:pass2",
    "proxy3.example.com:8082:user3:pass3",
].join("\n");
const FIVE_PROXIES = [
    "p1.example.com:8080:u1:p1",
    "p2.example.com:8081:u2:p2",
    "p3.example.com:8082:u3:p3",
    "p4.example.com:8083:u4:p4",
    "p5.example.com:8084:u5:p5",
].join("\n");
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ProxyManager", () => {
    let redis;
    beforeEach(() => {
        redis = new MockRedis();
    });
    // ── Parsing ─────────────────────────────────────────────────────────────
    describe("parseProxyList", () => {
        it("parses host:port:user:pass lines correctly", () => {
            const proxies = ProxyManager_1.ProxyManager.parseProxyList(THREE_PROXIES);
            expect(proxies).toHaveLength(3);
            expect(proxies[0]).toEqual({
                host: "proxy1.example.com",
                port: 8080,
                username: "user1",
                password: "pass1",
            });
        });
        it("handles passwords containing colons", () => {
            const proxies = ProxyManager_1.ProxyManager.parseProxyList("host.example.com:9090:admin:p@ss:word:complex");
            expect(proxies).toHaveLength(1);
            expect(proxies[0].password).toBe("p@ss:word:complex");
        });
        it("ignores empty lines and whitespace-only lines", () => {
            const raw = "\n  \nproxy1.example.com:8080:user1:pass1\n\n  \n";
            const proxies = ProxyManager_1.ProxyManager.parseProxyList(raw);
            expect(proxies).toHaveLength(1);
        });
        it("throws on entries with fewer than 4 colon-separated parts", () => {
            expect(() => ProxyManager_1.ProxyManager.parseProxyList("bad-entry:8080")).toThrow("invalid proxy entry");
        });
        it("throws on invalid port numbers", () => {
            expect(() => ProxyManager_1.ProxyManager.parseProxyList("host:notaport:user:pass")).toThrow("invalid port");
        });
    });
    // ── Constructor ─────────────────────────────────────────────────────────
    describe("constructor", () => {
        it("throws when proxy list is empty string", () => {
            expect(() => new ProxyManager_1.ProxyManager(redis, "")).toThrow("no valid entries");
        });
        it("throws when proxy list is only whitespace / empty lines", () => {
            expect(() => new ProxyManager_1.ProxyManager(redis, "\n  \n\n")).toThrow("no valid entries");
        });
        it("reports correct pool size", () => {
            const pm = new ProxyManager_1.ProxyManager(redis, THREE_PROXIES);
            expect(pm.getPoolSize()).toBe(3);
        });
    });
    // ── getProxy — rotation & cooldown ──────────────────────────────────────
    describe("getProxy", () => {
        it("returns a proxy not used for the given domain in last 15 min", async () => {
            const pm = new ProxyManager_1.ProxyManager(redis, THREE_PROXIES);
            const proxy = await pm.getProxy("samesnissan.com");
            expect(proxy).toBeDefined();
            expect(proxy.host).toBe("proxy1.example.com");
        });
        it("rotates proxies so the same IP is not reused for the same domain", async () => {
            const pm = new ProxyManager_1.ProxyManager(redis, THREE_PROXIES);
            const p1 = await pm.getProxy("samesnissan.com");
            const p2 = await pm.getProxy("samesnissan.com");
            const p3 = await pm.getProxy("samesnissan.com");
            // All three should be different
            const hosts = [p1.host, p2.host, p3.host];
            expect(new Set(hosts).size).toBe(3);
        });
        it("allows reuse of the same proxy for different dealer domains", async () => {
            // Pool of 1 proxy — forces reuse across domains
            const pm = new ProxyManager_1.ProxyManager(redis, "solo.example.com:8080:user1:pass1");
            const p1 = await pm.getProxy("samesnissan.com");
            const p2 = await pm.getProxy("toyotaoflaredo.com");
            // Same proxy can be used for different domains
            expect(p1.host).toBe(p2.host);
        });
        it("never returns the same proxy for the same domain within cooldown (20 requests)", async () => {
            const pm = new ProxyManager_1.ProxyManager(redis, FIVE_PROXIES);
            const domain = "samesnissan.com";
            const usedHosts = [];
            for (let i = 0; i < 5; i++) {
                const proxy = await pm.getProxy(domain);
                expect(usedHosts).not.toContain(proxy.host);
                usedHosts.push(proxy.host);
            }
            // All 5 proxies consumed — further requests should throw
            await expect(pm.getProxy(domain)).rejects.toThrow("no eligible proxy");
        });
        it("simulates 20 requests across multiple domains without IP reuse per domain", async () => {
            const pm = new ProxyManager_1.ProxyManager(redis, FIVE_PROXIES);
            const domains = ["domain-a.com", "domain-b.com", "domain-c.com", "domain-d.com"];
            const usedPerDomain = new Map();
            for (let i = 0; i < 20; i++) {
                const domain = domains[i % domains.length];
                const proxy = await pm.getProxy(domain);
                if (!usedPerDomain.has(domain)) {
                    usedPerDomain.set(domain, new Set());
                }
                const used = usedPerDomain.get(domain);
                // The same IP must not appear twice for the same domain
                expect(used.has(proxy.host)).toBe(false);
                used.add(proxy.host);
            }
        });
        it("throws when all proxies are on cooldown for the requested domain", async () => {
            const pm = new ProxyManager_1.ProxyManager(redis, THREE_PROXIES);
            const domain = "samesnissan.com";
            // Exhaust all 3 proxies
            await pm.getProxy(domain);
            await pm.getProxy(domain);
            await pm.getProxy(domain);
            await expect(pm.getProxy(domain)).rejects.toThrow('no eligible proxy available for domain "samesnissan.com"');
        });
        it("sets a Redis cooldown key with the correct prefix pattern", async () => {
            const pm = new ProxyManager_1.ProxyManager(redis, THREE_PROXIES);
            await pm.getProxy("samesnissan.com");
            const keys = redis.keys();
            expect(keys).toContain("proxy:used:samesnissan.com:proxy1.example.com");
        });
    });
    // ── Health tracking ─────────────────────────────────────────────────────
    describe("reportFailure / reportSuccess", () => {
        it("excludes a proxy after 3 consecutive failures", async () => {
            const pm = new ProxyManager_1.ProxyManager(redis, THREE_PROXIES);
            const proxy = await pm.getProxy("domain-a.com");
            await pm.reportFailure(proxy);
            await pm.reportFailure(proxy);
            await pm.reportFailure(proxy);
            // The unhealthy proxy should be skipped for any domain
            redis.clear();
            const pm2 = new ProxyManager_1.ProxyManager(redis, THREE_PROXIES);
            // Re-add just the unhealthy flag
            await redis.set(`proxy:unhealthy:${proxy.host}`, "1");
            const next = await pm2.getProxy("new-domain.com");
            expect(next.host).not.toBe(proxy.host);
        });
        it("does not exclude a proxy with fewer than 3 failures", async () => {
            const pm = new ProxyManager_1.ProxyManager(redis, THREE_PROXIES);
            const proxy = await pm.getProxy("domain-a.com");
            await pm.reportFailure(proxy);
            await pm.reportFailure(proxy);
            // Proxy should NOT be marked unhealthy
            const isUnhealthy = await redis.exists(`proxy:unhealthy:${proxy.host}`);
            expect(isUnhealthy).toBe(0);
        });
        it("reportSuccess resets the failure counter", async () => {
            const pm = new ProxyManager_1.ProxyManager(redis, THREE_PROXIES);
            const proxy = await pm.getProxy("domain-a.com");
            await pm.reportFailure(proxy);
            await pm.reportFailure(proxy);
            await pm.reportSuccess(proxy);
            // Two more failures should not trigger unhealthy (counter was reset)
            await pm.reportFailure(proxy);
            await pm.reportFailure(proxy);
            const isUnhealthy = await redis.exists(`proxy:unhealthy:${proxy.host}`);
            expect(isUnhealthy).toBe(0);
        });
        it("logs a structured warning when a proxy is marked unhealthy", async () => {
            const logSpy = jest.spyOn(console, "log").mockImplementation();
            const pm = new ProxyManager_1.ProxyManager(redis, THREE_PROXIES);
            const proxy = await pm.getProxy("domain-a.com");
            await pm.reportFailure(proxy);
            await pm.reportFailure(proxy);
            await pm.reportFailure(proxy);
            expect(logSpy).toHaveBeenCalledTimes(1);
            const logged = JSON.parse(logSpy.mock.calls[0][0]);
            expect(logged.level).toBe("warn");
            expect(logged.message).toBe("Proxy marked unhealthy");
            expect(logged.proxyHost).toBe(proxy.host);
            expect(logged.consecutiveFailures).toBe(3);
            logSpy.mockRestore();
        });
    });
    // ── Pool health ─────────────────────────────────────────────────────────
    describe("getHealthyPoolSize", () => {
        it("returns full pool size when all proxies are healthy", async () => {
            const pm = new ProxyManager_1.ProxyManager(redis, THREE_PROXIES);
            expect(await pm.getHealthyPoolSize()).toBe(3);
        });
        it("excludes unhealthy proxies from the count", async () => {
            const pm = new ProxyManager_1.ProxyManager(redis, THREE_PROXIES);
            const proxy = await pm.getProxy("domain-a.com");
            // Mark unhealthy
            await pm.reportFailure(proxy);
            await pm.reportFailure(proxy);
            await pm.reportFailure(proxy);
            expect(await pm.getHealthyPoolSize()).toBe(2);
        });
    });
});
