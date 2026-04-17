// require() here resolves to tests/__mocks__/@aws-sdk/* via moduleNameMapper,
// giving us the same mock instances that StorageClient.ts uses.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { mockSend, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// Import once so all tests share the same module (and therefore the same mock instances).
import { StorageClient } from "../src/storage/StorageClient";

beforeEach(() => {
  jest.clearAllMocks();
  process.env["S3_BUCKET_NAME"] = "cartool-raw-html";
  process.env["AWS_REGION"] = "us-east-1";
  process.env["AWS_ACCESS_KEY_ID"] = "test-key-id";
  process.env["AWS_SECRET_ACCESS_KEY"] = "test-secret";
});

afterEach(() => {
  delete process.env["S3_BUCKET_NAME"];
  delete process.env["AWS_REGION"];
  delete process.env["AWS_ACCESS_KEY_ID"];
  delete process.env["AWS_SECRET_ACCESS_KEY"];
});

describe("StorageClient", () => {
  describe("constructor", () => {
    it("throws when a required env var is missing", () => {
      delete process.env["S3_BUCKET_NAME"];
      expect(() => new StorageClient()).toThrow(
        "StorageClient: missing required environment variables: S3_BUCKET_NAME"
      );
    });
  });

  describe("upload()", () => {
    it("calls PutObjectCommand with the correct bucket, key, and body", async () => {
      const client = new StorageClient();
      const body = Buffer.from("<html>test</html>");

      await client.upload("raw-html/2026-04-16/vin123.html", body);

      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: "cartool-raw-html",
        Key: "raw-html/2026-04-16/vin123.html",
        Body: body,
        ContentType: "text/html",
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("accepts a custom contentType", async () => {
      const client = new StorageClient();
      await client.upload("archive/dump.json", Buffer.from("{}"), "application/json");

      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({ ContentType: "application/json" })
      );
    });
  });

  describe("getSignedUrl()", () => {
    it("returns a signed URL string", async () => {
      const client = new StorageClient();
      const url = await client.getSignedUrl("raw-html/2026-04-16/vin123.html");

      expect(typeof url).toBe("string");
      expect(url).toContain("https://");
    });

    it("passes the expiresIn option to the presigner", async () => {
      const client = new StorageClient();
      await client.getSignedUrl("some/key", 7200);

      expect(getSignedUrl).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(Object),
        { expiresIn: 7200 }
      );
    });

    it("uses GetObjectCommand for the presigned URL", async () => {
      const client = new StorageClient();
      await client.getSignedUrl("some/key");

      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: "cartool-raw-html",
        Key: "some/key",
      });
    });
  });
});
