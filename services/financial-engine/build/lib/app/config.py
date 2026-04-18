import os


def validate_env(required: list[str]) -> None:
    """Fail fast if any required environment variables are missing."""
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        raise RuntimeError(
            f"Missing required environment variables: {', '.join(missing)}"
        )


REQUIRED_VARS = ["DATABASE_URL"]

validate_env(REQUIRED_VARS)

DATABASE_URL: str = os.environ["DATABASE_URL"]
PORT: int = int(os.environ.get("PORT", "8000"))
