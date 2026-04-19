import express, { Application } from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { createListingsRouter } from "./routes/listings";
import { createReverseSearchRouter } from "./routes/reverse-search";
import { createDealersRouter } from "./routes/dealers";
import { createBuyRatesRouter } from "./routes/buy-rates";

export interface AppConfig {
  nodeEnv: string;
  corsAllowedOrigins: string[];
  /** Override for testing; defaults to 60 in production. */
  rateLimitMax?: number;
  /** URL of the Python Financial Engine service (e.g. http://financial-engine:8000). */
  financialEngineUrl: string;
  /** Secret used to verify JWTs. Required for protected endpoints. */
  jwtSecret?: string;
}

export function createApp(appConfig: AppConfig): Application {
  const app = express();

  // ── Security headers (Helmet defaults cover nosniff, X-Frame-Options, HSTS, etc.)
  app.use(helmet());

  // ── CORS: wildcard only in non-production environments
  app.use(
    cors({
      origin:
        appConfig.nodeEnv === "production"
          ? appConfig.corsAllowedOrigins
          : true,
      credentials: true,
    })
  );

  // ── JSON body parsing
  app.use(express.json());

  // ── Rate limiting: 60 requests/min per IP on all routes
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: appConfig.rateLimitMax ?? 60,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "Too many requests, please try again later." },
    })
  );

  // ── Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "api" });
  });

  // ── Listings
  app.use("/listings", createListingsRouter(appConfig.financialEngineUrl));

  // ── Reverse Search
  app.use("/reverse-search", createReverseSearchRouter(appConfig.financialEngineUrl));

  // ── Dealers
  app.use("/dealers", createDealersRouter());

  // ── Buy Rates (admin only)
  app.use("/buy-rates", createBuyRatesRouter(appConfig.jwtSecret ?? ""));

  return app;
}
