"""Database connection module.

Provides a context manager that yields a psycopg2 connection.
The DATABASE_URL is sourced from app.config so that the fail-fast
startup validation always runs before any connection is attempted.
"""

from contextlib import contextmanager
from typing import Generator

import psycopg2
import psycopg2.extensions

from app.config import DATABASE_URL


@contextmanager
def get_connection() -> Generator[psycopg2.extensions.connection, None, None]:
    """Yield a psycopg2 connection and ensure it is closed on exit.

    Usage::

        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")

    The caller is responsible for committing or rolling back.
    """
    conn: psycopg2.extensions.connection = psycopg2.connect(DATABASE_URL)
    try:
        yield conn
    finally:
        conn.close()
