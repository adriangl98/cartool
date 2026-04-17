from fastapi import FastAPI

import app.config  # noqa: F401 — validate env vars at startup

app = FastAPI(title="cartool financial-engine")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "financial-engine"}
