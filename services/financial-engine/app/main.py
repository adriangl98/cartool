from fastapi import FastAPI

app = FastAPI(title="cartool financial-engine")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "financial-engine"}
