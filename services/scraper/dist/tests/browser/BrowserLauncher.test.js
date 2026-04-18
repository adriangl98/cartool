"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const userAgents_1 = require("../../src/browser/userAgents");
const mockGetProxy = jest.fn();
jest.mock("../../src/browser/ProxyManager", () => ({
    proxyManager: () => ({ getProxy: mockGetProxy }),
}));
const mockNewPage = jest.fn().mockResolvedValue({ isMockPage: true });
const mockNewContext = jest.fn().mockResolvedValue({ newPage: mockNewPage });
const mockBrowser = {
    newContext: mockNewContext,
    version: jest.fn().mockReturnValue("130.0.0.0"),
    close: jest.fn(),
};
const mockLaunch = jest.fn().mockResolvedValue(mockBrowser);
jest.mock("playwright-extra", () => ({
    chromium: {
        use: jest.fn(),
        launch: (...args) => mockLaunch(...args),
    },
}));
jest.mock("puppeteer-extra-plugin-stealth", () => {
    return jest.fn().mockReturnValue({ name: "stealth" });
});
const BrowserLauncher_1 = require("../../src/browser/BrowserLauncher");
const ACCEPT_LANGUAGES = [
    "en-US,en;q=0.9",
    "en-US,es-MX;q=0.8,en;q=0.7",
    "es-MX,es;q=0.9,en-US;q=0.8",
];
describe("BrowserLauncher", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    it("returns a browser and page object", async () => {
        const result = await BrowserLauncher_1.BrowserLauncher.launch();
        expect(result.browser).toBeDefined();
        expect(result.page).toBeDefined();
    });
    it("launches chromium with --no-sandbox args", async () => {
        await BrowserLauncher_1.BrowserLauncher.launch();
        expect(mockLaunch).toHaveBeenCalledWith(expect.objectContaining({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        }));
    });
    it("creates a context with randomized viewport within bounds", async () => {
        // Run multiple launches to check randomization bounds
        for (let i = 0; i < 20; i++) {
            await BrowserLauncher_1.BrowserLauncher.launch();
        }
        for (const call of mockNewContext.mock.calls) {
            const opts = call[0];
            expect(opts.viewport.width).toBeGreaterThanOrEqual(1280);
            expect(opts.viewport.width).toBeLessThanOrEqual(1920);
            expect(opts.viewport.height).toBeGreaterThanOrEqual(720);
            expect(opts.viewport.height).toBeLessThanOrEqual(1080);
        }
    });
    it("assigns a user agent from the curated list", async () => {
        for (let i = 0; i < 20; i++) {
            await BrowserLauncher_1.BrowserLauncher.launch();
        }
        for (const call of mockNewContext.mock.calls) {
            const opts = call[0];
            expect(userAgents_1.USER_AGENTS).toContain(opts.userAgent);
        }
    });
    it("assigns an Accept-Language from the expected variants", async () => {
        for (let i = 0; i < 20; i++) {
            await BrowserLauncher_1.BrowserLauncher.launch();
        }
        for (const call of mockNewContext.mock.calls) {
            const opts = call[0];
            expect(ACCEPT_LANGUAGES).toContain(opts.extraHTTPHeaders["Accept-Language"]);
        }
    });
    it("forwards proxy options when provided", async () => {
        const proxy = {
            server: "http://proxy.example.com:8080",
            username: "user",
            password: "pass",
        };
        await BrowserLauncher_1.BrowserLauncher.launch({ proxy });
        expect(mockLaunch).toHaveBeenCalledWith(expect.objectContaining({
            proxy: {
                server: proxy.server,
                username: proxy.username,
                password: proxy.password,
            },
        }));
    });
    it("does not include proxy when not provided", async () => {
        await BrowserLauncher_1.BrowserLauncher.launch();
        const launchCall = mockLaunch.mock.calls[0][0];
        expect(launchCall.proxy).toBeUndefined();
    });
    it("emits a structured JSON log on launch", async () => {
        const logSpy = jest.spyOn(console, "log").mockImplementation();
        await BrowserLauncher_1.BrowserLauncher.launch();
        expect(logSpy).toHaveBeenCalledTimes(1);
        const logged = JSON.parse(logSpy.mock.calls[0][0]);
        expect(logged.level).toBe("info");
        expect(logged.message).toBe("Browser launched");
        expect(logged.viewport).toBeDefined();
        expect(logged.userAgent).toBeDefined();
        expect(logged.acceptLanguage).toBeDefined();
        logSpy.mockRestore();
    });
    it("auto-injects a rotated proxy when dealerDomain is provided", async () => {
        mockGetProxy.mockResolvedValueOnce({
            host: "rotated.proxy.com",
            port: 9090,
            username: "ruser",
            password: "rpass",
        });
        await BrowserLauncher_1.BrowserLauncher.launch({ dealerDomain: "samesnissan.com" });
        expect(mockGetProxy).toHaveBeenCalledWith("samesnissan.com");
        expect(mockLaunch).toHaveBeenCalledWith(expect.objectContaining({
            proxy: {
                server: "http://rotated.proxy.com:9090",
                username: "ruser",
                password: "rpass",
            },
        }));
    });
    it("prefers explicit proxy over dealerDomain auto-injection", async () => {
        const explicit = {
            server: "http://explicit.proxy.com:1234",
            username: "eu",
            password: "ep",
        };
        await BrowserLauncher_1.BrowserLauncher.launch({
            proxy: explicit,
            dealerDomain: "samesnissan.com",
        });
        // ProxyManager should NOT be called when explicit proxy is provided
        expect(mockGetProxy).not.toHaveBeenCalled();
        expect(mockLaunch).toHaveBeenCalledWith(expect.objectContaining({ proxy: explicit }));
    });
});
