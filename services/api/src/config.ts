import { validateEnv } from "@cartool/shared";

validateEnv(["DATABASE_URL", "REDIS_URL", "FINANCIAL_ENGINE_URL", "JWT_SECRET"]);

export const config = {
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  databaseUrl: process.env.DATABASE_URL as string,
  redisUrl: process.env.REDIS_URL as string,
  financialEngineUrl: process.env.FINANCIAL_ENGINE_URL as string,
  jwtSecret: process.env.JWT_SECRET as string,
};

