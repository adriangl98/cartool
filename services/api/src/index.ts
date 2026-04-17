import express from "express";
import helmet from "helmet";
import { validateEnv } from "@cartool/shared";

validateEnv(["DATABASE_URL", "REDIS_URL"]);

const app = express();
app.use(helmet());
const port = Number(process.env.PORT ?? 3000);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "api" });
});

app.listen(port, () => {
  console.log(JSON.stringify({ level: "info", message: `api service listening on ${port}` }));
});
