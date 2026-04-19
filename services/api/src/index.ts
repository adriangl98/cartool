import { config } from "./config";
import { createApp } from "./app";

const app = createApp({
  nodeEnv: config.nodeEnv,
  corsAllowedOrigins: config.corsAllowedOrigins,
  financialEngineUrl: config.financialEngineUrl,
  jwtSecret: config.jwtSecret,
});

app.listen(config.port, () => {
  console.log(
    JSON.stringify({
      level: "info",
      message: `api service listening on ${config.port}`,
    })
  );
});

