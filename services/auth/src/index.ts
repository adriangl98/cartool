import express from "express";
import helmet from "helmet";
import { validateEnv } from "@cartool/shared";

validateEnv(["DATABASE_URL", "REDIS_URL", "JWT_SECRET", "REFRESH_TOKEN_SECRET"]);

const app = express();
app.use(helmet());
const port = Number(process.env.PORT ?? 3001);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "auth" });
});

app.listen(port, () => {
  console.log(JSON.stringify({ level: "info", message: `auth service listening on ${port}` }));
});
