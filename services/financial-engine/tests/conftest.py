"""Pytest configuration for financial-engine unit tests.

Sets DATABASE_URL before any app module is imported so that app.config's
fail-fast startup validation does not abort test collection.

All tests that touch database code mock get_connection — no real DB is needed.
"""

import os

# Must be set before any `from app.xxx` import triggers app.config validation.
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/testdb")
