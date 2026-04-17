import { randomInt } from "node:crypto";
import type { Page } from "playwright-core";

/**
 * Simulates human-like browser interactions to avoid bot detection.
 */
export class HumanBehavior {
  /**
   * Scrolls the page in incremental steps with random delays.
   * Never scrolls to the bottom in a single jump.
   */
  static async randomScroll(page: Page): Promise<void> {
    const scrollHeight: number = await page.evaluate(
      "document.body.scrollHeight"
    );
    const viewportHeight: number = await page.evaluate("window.innerHeight");
    let scrolled = 0;

    while (scrolled < scrollHeight - viewportHeight) {
      const step = randomInt(100, 301); // 100–300px per step
      const delay = randomInt(100, 401); // 100–400ms between steps

      await page.evaluate(
        `window.scrollBy(0, ${step})`
      );
      await page.waitForTimeout(delay);

      scrolled += step;
    }
  }

  /**
   * Moves the mouse along a curved path to the target before clicking.
   * Generates 3–5 bezier-curve waypoints for a natural trajectory.
   */
  static async randomMousePath(
    page: Page,
    targetX: number,
    targetY: number
  ): Promise<void> {
    const box: { x: number; y: number } = await page.evaluate(
      "({ x: window._mouseX || 0, y: window._mouseY || 0 })"
    );

    const startX = box.x;
    const startY = box.y;
    const waypointCount = randomInt(3, 6); // 3–5 waypoints

    for (let i = 1; i <= waypointCount; i++) {
      const t = i / (waypointCount + 1);
      // Quadratic bezier with randomized control point
      const controlX =
        (startX + targetX) / 2 + randomInt(-100, 101);
      const controlY =
        (startY + targetY) / 2 + randomInt(-100, 101);

      const x = (1 - t) * (1 - t) * startX + 2 * (1 - t) * t * controlX + t * t * targetX;
      const y = (1 - t) * (1 - t) * startY + 2 * (1 - t) * t * controlY + t * t * targetY;

      await page.mouse.move(Math.round(x), Math.round(y));
      await page.waitForTimeout(randomInt(20, 81)); // small delay between moves
    }

    await page.mouse.click(targetX, targetY);
  }
}
