"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserLauncher = void 0;
const playwright_extra_1 = require("playwright-extra");
const puppeteer_extra_plugin_stealth_1 = __importDefault(require("puppeteer-extra-plugin-stealth"));
const node_crypto_1 = require("node:crypto");
const userAgents_1 = require("./userAgents");
const ProxyManager_1 = require("./ProxyManager");
playwright_extra_1.chromium.use((0, puppeteer_extra_plugin_stealth_1.default)());
const ACCEPT_LANGUAGES = [
    "en-US,en;q=0.9",
    "en-US,es-MX;q=0.8,en;q=0.7",
    "es-MX,es;q=0.9,en-US;q=0.8",
];
class BrowserLauncher {
    /**
     * Launch a stealth-hardened Chromium instance with randomized fingerprint.
     * Caller is responsible for closing the browser when done.
     */
    static async launch(options) {
        const viewportWidth = (0, node_crypto_1.randomInt)(1280, 1921); // upper bound exclusive
        const viewportHeight = (0, node_crypto_1.randomInt)(720, 1081);
        const userAgent = userAgents_1.USER_AGENTS[(0, node_crypto_1.randomInt)(0, userAgents_1.USER_AGENTS.length)];
        const acceptLanguage = ACCEPT_LANGUAGES[(0, node_crypto_1.randomInt)(0, ACCEPT_LANGUAGES.length)];
        const launchOptions = {
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        };
        let resolvedProxy = options?.proxy;
        // Auto-inject a rotated proxy when dealerDomain is set and no explicit proxy given
        if (!resolvedProxy && options?.dealerDomain) {
            const pm = (0, ProxyManager_1.proxyManager)();
            if (pm) {
                const rotated = await pm.getProxy(options.dealerDomain);
                resolvedProxy = {
                    server: `http://${rotated.host}:${rotated.port}`,
                    username: rotated.username,
                    password: rotated.password,
                };
            }
        }
        if (resolvedProxy) {
            launchOptions["proxy"] = {
                server: resolvedProxy.server,
                username: resolvedProxy.username,
                password: resolvedProxy.password,
            };
        }
        const browser = await playwright_extra_1.chromium.launch(launchOptions);
        const context = await browser.newContext({
            viewport: { width: viewportWidth, height: viewportHeight },
            userAgent,
            extraHTTPHeaders: { "Accept-Language": acceptLanguage },
        });
        const page = await context.newPage();
        console.log(JSON.stringify({
            level: "info",
            message: "Browser launched",
            viewport: { width: viewportWidth, height: viewportHeight },
            userAgent,
            acceptLanguage,
            proxy: resolvedProxy?.server ?? null,
        }));
        return { browser, page };
    }
}
exports.BrowserLauncher = BrowserLauncher;
