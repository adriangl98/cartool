import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "auth" });
});

app.listen(port, () => {
  console.log(JSON.stringify({ level: "info", message: `auth service listening on ${port}` }));
});
