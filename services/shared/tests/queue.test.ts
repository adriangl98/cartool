import { Queue, Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { QUEUE_NAMES, CACHE_TTL_SECONDS } from "../src/queue/constants";

describe("queue constants", () => {
  it("defines the three required queue names with no magic strings", () => {
    expect(QUEUE_NAMES.SCRAPE).toBe("scrape-jobs");
    expect(QUEUE_NAMES.ENRICHMENT).toBe("enrichment-jobs");
    expect(QUEUE_NAMES.NOTIFICATION).toBe("notification-jobs");
  });

  it("defines CACHE_TTL_SECONDS as 3600", () => {
    expect(CACHE_TTL_SECONDS).toBe(3600);
  });
});

describe("createRedisClient", () => {
  afterEach(() => {
    delete process.env["REDIS_URL"];
    jest.resetModules();
  });

  it("throws when REDIS_URL is not set", () => {
    delete process.env["REDIS_URL"];
    jest.mock("ioredis", () => jest.fn());
    // The module exports a singleton `redisClient` that is created at import time,
    // so the require() itself throws — not a subsequent call.
    expect(() => require("../src/queue/redisClient")).toThrow(
      "RedisClient: missing required environment variable: REDIS_URL"
    );
  });

  it("constructs an ioredis instance when REDIS_URL is set", () => {
    process.env["REDIS_URL"] = "redis://localhost:6379";
    const MockRedis = jest.fn().mockImplementation(() => ({ status: "wait" }));
    jest.mock("ioredis", () => MockRedis);
    const { createRedisClient } = require("../src/queue/redisClient");
    const client = createRedisClient();
    expect(MockRedis).toHaveBeenCalledWith("redis://localhost:6379", {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    expect(client).toBeDefined();
  });
});

/**
 * Integration test: BullMQ enqueue + dequeue using a real Redis connection.
 *
 * Skipped automatically when REDIS_URL is not set so the unit suite can run
 * without a live Redis instance. CI provides Redis via `services: redis`.
 */
const REDIS_URL = process.env["REDIS_URL"];
const describeIfRedis = REDIS_URL ? describe : describe.skip;

describeIfRedis("BullMQ — enqueue and dequeue (integration)", () => {
  const TEST_QUEUE_NAME = `${QUEUE_NAMES.SCRAPE}-test-${Date.now()}`;
  let connection: IORedis;
  let queue: Queue;

  beforeAll(() => {
    connection = new IORedis(REDIS_URL!, { maxRetriesPerRequest: null });
    queue = new Queue(TEST_QUEUE_NAME, { connection });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    await connection.quit();
  });

  it("enqueues a job and a worker processes it", async () => {
    const processed: Job[] = [];

    const worker = new Worker(
      TEST_QUEUE_NAME,
      async (job) => {
        processed.push(job);
      },
      { connection: new IORedis(REDIS_URL!, { maxRetriesPerRequest: null }), autorun: true }
    );

    const job = await queue.add("ping", { value: "pong" });
    expect(job.id).toBeDefined();

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Worker timed out after 5s")), 5000);
      worker.on("completed", () => { clearTimeout(timeout); resolve(); });
      worker.on("failed", (_j, err) => { clearTimeout(timeout); reject(err); });
    });

    expect(processed).toHaveLength(1);
    expect(processed[0].data).toEqual({ value: "pong" });

    await worker.close();
  }, 10_000);
});
