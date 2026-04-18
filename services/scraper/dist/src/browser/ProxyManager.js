"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProxyManager = void 0;
exports.proxyManager = proxyManager;
const COOLDOWN_TTL_SECONDS = 900; // 15 minutes
const MAX_CONSECUTIVE_FAILURES = 3;
const REDIS_PREFIX = {
    USED: "proxy:used",
    FAILURES: "proxy:failures",
    UNHEALTHY: "proxy:unhealthy",
};
/**
 * Manages a pool of residential proxies with per-dealer-domain cooldown
 * and health tracking via Redis.
 *
 * - Never reuses the same proxy IP for the same dealer domain within 15 minutes.
 * - Marks proxies as unhealthy after 3 consecutive non-200 responses.
 * - Unhealthy proxies are excluded from rotation until the service restarts.
 */
class ProxyManager {
    pool;
    redis;
    roundRobinIndex = 0;
    constructor(redis, proxyListRaw) {
        this.redis = redis;
        this.pool = ProxyManager.parseProxyList(proxyListRaw);
        if (this.pool.length === 0) {
            throw new Error("ProxyManager: PROXY_LIST contains no valid entries. " +
                "Expected newline-separated host:port:user:pass strings.");
        }
    }
    /**
     * Parse newline-separated `host:port:user:pass` strings into Proxy objects.
     * Ignores empty lines and whitespace-only lines.
     */
    static parseProxyList(raw) {
        return raw
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => {
            const parts = line.split(":");
            if (parts.length < 4) {
                throw new Error(`ProxyManager: invalid proxy entry "${line}". ` +
                    "Expected format: host:port:user:pass");
            }
            const [host, portStr, ...rest] = parts;
            const port = Number(portStr);
            if (!Number.isInteger(port) || port <= 0 || port > 65535) {
                throw new Error(`ProxyManager: invalid port "${portStr}" in proxy entry "${line}".`);
            }
            // Rejoin remaining parts in case password contains ':'
            const username = rest[0];
            const password = rest.slice(1).join(":");
            return { host, port, username, password };
        });
    }
    /**
     * Returns a proxy not used for `dealerDomain` in the last 15 minutes
     * and not flagged as unhealthy.
     *
     * Uses round-robin ordering to distribute load across the pool,
     * then skips any proxy that is on cooldown or unhealthy.
     *
     * @throws Error if no eligible proxy is available.
     */
    async getProxy(dealerDomain) {
        const poolSize = this.pool.length;
        for (let i = 0; i < poolSize; i++) {
            const index = (this.roundRobinIndex + i) % poolSize;
            const proxy = this.pool[index];
            const [isOnCooldown, isUnhealthy] = await Promise.all([
                this.redis.exists(this.cooldownKey(dealerDomain, proxy)),
                this.redis.exists(this.unhealthyKey(proxy)),
            ]);
            if (isOnCooldown || isUnhealthy) {
                continue;
            }
            // Mark this proxy as used for this dealer domain
            await this.redis.set(this.cooldownKey(dealerDomain, proxy), "1", "EX", COOLDOWN_TTL_SECONDS);
            // Advance round-robin past the selected proxy
            this.roundRobinIndex = (index + 1) % poolSize;
            return proxy;
        }
        throw new Error(`ProxyManager: no eligible proxy available for domain "${dealerDomain}". ` +
            `All ${poolSize} proxies are on cooldown or unhealthy.`);
    }
    /**
     * Report a failed request through this proxy.
     * After 3 consecutive failures, the proxy is marked unhealthy.
     */
    async reportFailure(proxy) {
        const key = this.failuresKey(proxy);
        const count = await this.redis.incr(key);
        if (count >= MAX_CONSECUTIVE_FAILURES) {
            await this.redis.set(this.unhealthyKey(proxy), "1");
            console.log(JSON.stringify({
                level: "warn",
                message: "Proxy marked unhealthy",
                proxyHost: proxy.host,
                proxyPort: proxy.port,
                consecutiveFailures: count,
            }));
        }
    }
    /**
     * Report a successful request through this proxy.
     * Resets the consecutive failure counter.
     */
    async reportSuccess(proxy) {
        await this.redis.del(this.failuresKey(proxy));
    }
    /** Total number of proxies in the pool. */
    getPoolSize() {
        return this.pool.length;
    }
    /** Number of proxies not flagged as unhealthy. */
    async getHealthyPoolSize() {
        const checks = await Promise.all(this.pool.map((p) => this.redis.exists(this.unhealthyKey(p))));
        return checks.filter((v) => !v).length;
    }
    cooldownKey(dealerDomain, proxy) {
        return `${REDIS_PREFIX.USED}:${dealerDomain}:${proxy.host}`;
    }
    failuresKey(proxy) {
        return `${REDIS_PREFIX.FAILURES}:${proxy.host}`;
    }
    unhealthyKey(proxy) {
        return `${REDIS_PREFIX.UNHEALTHY}:${proxy.host}`;
    }
}
exports.ProxyManager = ProxyManager;
/**
 * Lazy singleton. Returns `undefined` if PROXY_LIST is not set,
 * allowing the scraper to start (e.g. for health checks) without proxies.
 */
let _instance;
function proxyManager() {
    if (_instance)
        return _instance;
    const raw = process.env["PROXY_LIST"];
    if (!raw)
        return undefined;
    // Lazy import to avoid circular dependency at module load time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { redisClient } = require("@cartool/shared");
    _instance = new ProxyManager(redisClient, raw);
    return _instance;
}
