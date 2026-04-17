import { HumanBehavior } from "../../src/browser/HumanBehavior";
import type { Page } from "playwright-core";

function createMockPage(scrollHeight = 1000, innerHeight = 600): Page {
  const evaluateFn = jest.fn();
  // First call returns scrollHeight, second returns innerHeight,
  // subsequent calls are scroll-by operations
  evaluateFn
    .mockResolvedValueOnce(scrollHeight) // document.body.scrollHeight
    .mockResolvedValueOnce(innerHeight)  // window.innerHeight
    .mockResolvedValue(undefined);       // scrollBy calls

  return {
    evaluate: evaluateFn,
    waitForTimeout: jest.fn().mockResolvedValue(undefined),
    mouse: {
      move: jest.fn().mockResolvedValue(undefined),
      click: jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as Page;
}

describe("HumanBehavior", () => {
  describe("randomScroll", () => {
    it("scrolls in multiple incremental steps, not a single jump", async () => {
      const page = createMockPage(1200, 600);

      await HumanBehavior.randomScroll(page);

      // scrollBy is called via evaluate after the first two metadata calls
      const scrollCalls = (page.evaluate as jest.Mock).mock.calls.slice(2);
      expect(scrollCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("adds a delay between each scroll step", async () => {
      const page = createMockPage(1200, 600);

      await HumanBehavior.randomScroll(page);

      const waitCalls = (page.waitForTimeout as jest.Mock).mock.calls;
      expect(waitCalls.length).toBeGreaterThanOrEqual(2);

      // All delays should be between 100–400ms
      for (const call of waitCalls) {
        expect(call[0]).toBeGreaterThanOrEqual(100);
        expect(call[0]).toBeLessThanOrEqual(400);
      }
    });

    it("does not scroll when content fits within viewport", async () => {
      const page = createMockPage(500, 600);

      await HumanBehavior.randomScroll(page);

      // Only the two initial metadata evaluate calls
      expect((page.evaluate as jest.Mock).mock.calls.length).toBe(2);
    });
  });

  describe("randomMousePath", () => {
    it("moves mouse through multiple intermediate points before clicking", async () => {
      const page = createMockPage();

      // Override evaluate to return mouse position
      (page.evaluate as jest.Mock).mockResolvedValue({ x: 0, y: 0 });

      await HumanBehavior.randomMousePath(page, 500, 500);

      const moveCalls = (page.mouse.move as jest.Mock).mock.calls;
      expect(moveCalls.length).toBeGreaterThanOrEqual(3);
      expect(moveCalls.length).toBeLessThanOrEqual(5);
    });

    it("clicks the target coordinates after the mouse path", async () => {
      const page = createMockPage();
      (page.evaluate as jest.Mock).mockResolvedValue({ x: 100, y: 100 });

      await HumanBehavior.randomMousePath(page, 300, 400);

      expect(page.mouse.click).toHaveBeenCalledWith(300, 400);
      expect(page.mouse.click).toHaveBeenCalledTimes(1);
    });

    it("adds delays between mouse movements", async () => {
      const page = createMockPage();
      (page.evaluate as jest.Mock).mockResolvedValue({ x: 0, y: 0 });

      await HumanBehavior.randomMousePath(page, 200, 200);

      // waitForTimeout called for each waypoint
      const waitCalls = (page.waitForTimeout as jest.Mock).mock.calls;
      expect(waitCalls.length).toBeGreaterThanOrEqual(3);
    });
  });
});
