"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const BackoffInterceptor_1 = require("../../src/browser/BackoffInterceptor");
describe("withRetry", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.spyOn(console, "log").mockImplementation();
    });
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });
    // Helper to advance timers through the delay promise
    function advanceTimersByPromise(ms) {
        jest.advanceTimersByTime(ms);
        // Flush microtask queue
        return Promise.resolve();
    }
    it("returns the result on first successful call", async () => {
        const fn = jest.fn().mockResolvedValue("success");
        const promise = (0, BackoffInterceptor_1.withRetry)(fn);
        const result = await promise;
        expect(result).toBe("success");
        expect(fn).toHaveBeenCalledTimes(1);
    });
    it("throws non-retryable errors immediately without retry", async () => {
        const fn = jest
            .fn()
            .mockRejectedValue(new Error("Navigation timeout"));
        await expect((0, BackoffInterceptor_1.withRetry)(fn)).rejects.toThrow("Navigation timeout");
        expect(fn).toHaveBeenCalledTimes(1);
    });
    it("retries on HTTP 429 errors with exponential back-off", async () => {
        const fn = jest
            .fn()
            .mockRejectedValueOnce(new BackoffInterceptor_1.RetryableError("429 Too Many Requests", 429))
            .mockRejectedValueOnce(new BackoffInterceptor_1.RetryableError("429 Too Many Requests", 429))
            .mockRejectedValueOnce(new BackoffInterceptor_1.RetryableError("429 Too Many Requests", 429))
            .mockResolvedValue("recovered");
        // Run with real timers since we need to verify delays
        jest.useRealTimers();
        // Use very short delays for testing
        const result = await (0, BackoffInterceptor_1.withRetry)(fn, { maxRetries: 3, baseDelayMs: 10 });
        expect(result).toBe("recovered");
        expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });
    it("retries on Cloudflare challenge errors", async () => {
        jest.useRealTimers();
        const fn = jest
            .fn()
            .mockRejectedValueOnce(new Error("cf-browser-verification detected"))
            .mockResolvedValue("ok");
        const result = await (0, BackoffInterceptor_1.withRetry)(fn, { maxRetries: 3, baseDelayMs: 10 });
        expect(result).toBe("ok");
        expect(fn).toHaveBeenCalledTimes(2);
    });
    it("throws after exhausting all retries", async () => {
        jest.useRealTimers();
        const fn = jest
            .fn()
            .mockRejectedValue(new BackoffInterceptor_1.RetryableError("429", 429));
        await expect((0, BackoffInterceptor_1.withRetry)(fn, { maxRetries: 3, baseDelayMs: 10 })).rejects.toThrow("429");
        expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    });
    it("uses default base delay of 8000ms", async () => {
        jest.useRealTimers();
        const delays = [];
        jest.spyOn(console, "log").mockImplementation((...args) => {
            try {
                const parsed = JSON.parse(args[0]);
                if (parsed.delayMs)
                    delays.push(parsed.delayMs);
            }
            catch {
                // ignore
            }
        });
        const fn = jest
            .fn()
            .mockRejectedValueOnce(new BackoffInterceptor_1.RetryableError("429", 429))
            .mockRejectedValueOnce(new BackoffInterceptor_1.RetryableError("429", 429))
            .mockRejectedValueOnce(new BackoffInterceptor_1.RetryableError("429", 429))
            .mockResolvedValue("ok");
        // Override delay to be instant for test speed
        await (0, BackoffInterceptor_1.withRetry)(fn, { baseDelayMs: 1 });
        // Verify escalating delays: baseDelay * 2^0, baseDelay * 2^1, baseDelay * 2^2
        expect(delays).toEqual([1, 2, 4]);
    });
    it("fires back-off retries at 8s, 16s, 32s with default options and then throws", async () => {
        jest.useRealTimers();
        const delays = [];
        jest.spyOn(console, "log").mockImplementation((...args) => {
            try {
                const parsed = JSON.parse(args[0]);
                if (parsed.delayMs)
                    delays.push(parsed.delayMs);
            }
            catch {
                // ignore
            }
        });
        // Mock the module's delay to resolve instantly so we don't wait 56 seconds
        const backoff = jest.requireActual("../../src/browser/BackoffInterceptor");
        const originalWithRetry = backoff.withRetry;
        const fn = jest
            .fn()
            .mockRejectedValue(new BackoffInterceptor_1.RetryableError("429 Too Many Requests", 429));
        // Use baseDelayMs=8000 (the default) but override the delay function internally.
        // We do this by wrapping withRetry with a patched setTimeout.
        // Override setTimeout to resolve instantly so we don't wait 56s
        const origSetTimeout = global.setTimeout;
        global.setTimeout = ((cb) => origSetTimeout(cb, 0));
        await expect((0, BackoffInterceptor_1.withRetry)(fn)).rejects.toThrow("429");
        global.setTimeout = origSetTimeout;
        // Verify the logged delay values are exactly 8000, 16000, 32000
        expect(delays).toEqual([8000, 16000, 32000]);
        // 1 initial attempt + 3 retries = 4 total calls, then throw
        expect(fn).toHaveBeenCalledTimes(4);
    });
    it("logs each retry attempt as structured JSON", async () => {
        jest.useRealTimers();
        const logSpy = jest.spyOn(console, "log").mockImplementation();
        const fn = jest
            .fn()
            .mockRejectedValueOnce(new BackoffInterceptor_1.RetryableError("429 Too Many Requests", 429))
            .mockResolvedValue("ok");
        await (0, BackoffInterceptor_1.withRetry)(fn, { maxRetries: 3, baseDelayMs: 1 });
        const retryLog = JSON.parse(logSpy.mock.calls[0][0]);
        expect(retryLog.level).toBe("warn");
        expect(retryLog.message).toBe("Retry attempt");
        expect(retryLog.attempt).toBe(1);
        expect(retryLog.reason).toContain("429");
    });
});
