import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { randomInt } from "node:crypto";
import type { Browser, Page } from "playwright-core";
import { USER_AGENTS } from "./userAgents";
import { proxyManager } from "./ProxyManager";

chromium.use(StealthPlugin());

const ACCEPT_LANGUAGES = [
  "en-US,en;q=0.9",
  "en-US,es-MX;q=0.8,en;q=0.7",
  "es-MX,es;q=0.9,en-US;q=0.8",
] as const;

export interface LaunchOptions {
  /** Explicit proxy — bypasses ProxyManager rotation. */
  proxy?: {
    server: string;
    username: string;
    password: string;
  };
  /** When set, ProxyManager auto-injects a rotated proxy for this domain. */
  dealerDomain?: string;
}

export interface LaunchResult {
  browser: Browser;
  page: Page;
}

export class BrowserLauncher {
  /**
   * Launch a stealth-hardened Chromium instance with randomized fingerprint.
   * Caller is responsible for closing the browser when done.
   */
  static async launch(options?: LaunchOptions): Promise<LaunchResult> {
    const viewportWidth = randomInt(1280, 1921); // upper bound exclusive
    const viewportHeight = randomInt(720, 1081);
    const userAgent = USER_AGENTS[randomInt(0, USER_AGENTS.length)];
    const acceptLanguage =
      ACCEPT_LANGUAGES[randomInt(0, ACCEPT_LANGUAGES.length)];

    const launchOptions: Record<string, unknown> = {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    };

    let resolvedProxy = options?.proxy;

    // Auto-inject a rotated proxy when dealerDomain is set and no explicit proxy given
    if (!resolvedProxy && options?.dealerDomain) {
      const pm = proxyManager();
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

    const browser = await chromium.launch(launchOptions);

    const context = await browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
      userAgent,
      extraHTTPHeaders: { "Accept-Language": acceptLanguage },
    });

    const page = await context.newPage();

    console.log(
      JSON.stringify({
        level: "info",
        message: "Browser launched",
        viewport: { width: viewportWidth, height: viewportHeight },
        userAgent,
        acceptLanguage,
        proxy: resolvedProxy?.server ?? null,
      })
    );

    return { browser, page };
  }
}
