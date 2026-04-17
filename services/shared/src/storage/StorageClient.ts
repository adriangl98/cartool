import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";

const REQUIRED_VARS = [
  "S3_BUCKET_NAME",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
] as const;

function assertEnv(): { bucket: string; region: string } {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `StorageClient: missing required environment variables: ${missing.join(", ")}`
    );
  }
  return {
    bucket: process.env["S3_BUCKET_NAME"] as string,
    region: process.env["AWS_REGION"] as string,
  };
}

export class StorageClient {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const { bucket, region } = assertEnv();
    this.bucket = bucket;
    this.client = new S3Client({ region });
  }

  /**
   * Upload an object to S3.
   * @param key    - S3 object key (e.g. "raw-html/2026-04-16/vin123.html")
   * @param body   - File content as a Buffer or Readable stream
   * @param contentType - MIME type; defaults to "text/html"
   */
  async upload(
    key: string,
    body: Buffer | Readable,
    contentType = "text/html"
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      })
    );
  }

  /**
   * Generate a pre-signed GET URL for a private S3 object.
   * @param key       - S3 object key
   * @param expiresIn - URL TTL in seconds (default: 3600)
   */
  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn });
  }
}

/** Lazily-constructed singleton for use across services. */
let _instance: StorageClient | undefined;
export function storageClient(): StorageClient {
  if (!_instance) _instance = new StorageClient();
  return _instance;
}
