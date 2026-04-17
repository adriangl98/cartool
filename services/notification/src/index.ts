import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 3002);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "notification" });
});

app.listen(port, () => {
  console.log(JSON.stringify({ level: "info", message: `notification service listening on ${port}` }));
});
