"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HumanBehavior = void 0;
const node_crypto_1 = require("node:crypto");
/**
 * Simulates human-like browser interactions to avoid bot detection.
 */
class HumanBehavior {
    /**
     * Scrolls the page in incremental steps with random delays.
     * Never scrolls to the bottom in a single jump.
     */
    static async randomScroll(page) {
        const scrollHeight = await page.evaluate("document.body.scrollHeight");
        const viewportHeight = await page.evaluate("window.innerHeight");
        let scrolled = 0;
        while (scrolled < scrollHeight - viewportHeight) {
            const step = (0, node_crypto_1.randomInt)(100, 301); // 100–300px per step
            const delay = (0, node_crypto_1.randomInt)(100, 401); // 100–400ms between steps
            await page.evaluate(`window.scrollBy(0, ${step})`);
            await page.waitForTimeout(delay);
            scrolled += step;
        }
    }
    /**
     * Moves the mouse along a curved path to the target before clicking.
     * Generates 3–5 bezier-curve waypoints for a natural trajectory.
     */
    static async randomMousePath(page, targetX, targetY) {
        const box = await page.evaluate("({ x: window._mouseX || 0, y: window._mouseY || 0 })");
        const startX = box.x;
        const startY = box.y;
        const waypointCount = (0, node_crypto_1.randomInt)(3, 6); // 3–5 waypoints
        for (let i = 1; i <= waypointCount; i++) {
            const t = i / (waypointCount + 1);
            // Quadratic bezier with randomized control point
            const controlX = (startX + targetX) / 2 + (0, node_crypto_1.randomInt)(-100, 101);
            const controlY = (startY + targetY) / 2 + (0, node_crypto_1.randomInt)(-100, 101);
            const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * controlX + t * t * targetX;
            const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * targetY;
            await page.mouse.move(Math.round(x), Math.round(y));
            await page.waitForTimeout((0, node_crypto_1.randomInt)(20, 81)); // small delay between moves
        }
        await page.mouse.click(targetX, targetY);
    }
}
exports.HumanBehavior = HumanBehavior;
