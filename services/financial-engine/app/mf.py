"""Money Factor markup detection module.

All arithmetic uses decimal.Decimal — no float.

Spec reference: §6.1 (Money Factor ↔ APR Conversion, Markup Detection,
                       Risk Classification)
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.db import get_connection

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MARKUP_THRESHOLD = Decimal("0.0004")
MF_MARKET_AVERAGE_2026 = Decimal("0.00220")

# Upper-inclusive boundaries for risk bands (spec §6.1)
_LOW_UPPER = Decimal("0.00100")
_MODERATE_UPPER = Decimal("0.00175")
_HIGH_UPPER = Decimal("0.00250")


# ---------------------------------------------------------------------------
# APR conversion
# ---------------------------------------------------------------------------


def mf_to_apr(mf: Decimal) -> Decimal:
    """Convert Money Factor to APR (%).

    Formula (spec §6.1):
        APR (%) = Money Factor × 2400

    Example: MF 0.00175 → APR 4.20%

    Result is quantized to 2 decimal places.
    """
    return (mf * Decimal("2400")).quantize(Decimal("0.01"))


def apr_to_mf(apr_pct: Decimal) -> Decimal:
    """Convert APR (%) to Money Factor.

    Formula (spec §6.1):
        Money Factor = APR (%) / 2400

    Result is quantized to 6 decimal places, matching the NUMERIC(8,6)
    precision of the buy_rates.base_mf column.
    """
    return (apr_pct / Decimal("2400")).quantize(Decimal("0.000001"))


# ---------------------------------------------------------------------------
# Risk classification
# ---------------------------------------------------------------------------


def classify_mf_risk(money_factor: Decimal) -> str:
    """Return a risk label for a given Money Factor.

    Bands (spec §6.1):
        ≤ 0.00100  → "Low"       (≤ 2.4% APR — likely base rate)
        ≤ 0.00175  → "Moderate"  (2.4%–4.2% APR — standard 2026 rate)
        ≤ 0.00250  → "High"      (4.2%–6.0% APR — potential dealer markup)
        > 0.00250  → "Very High" (> 6.0% APR — subprime or heavy markup)
    """
    if money_factor <= _LOW_UPPER:
        return "Low"
    if money_factor <= _MODERATE_UPPER:
        return "Moderate"
    if money_factor <= _HIGH_UPPER:
        return "High"
    return "Very High"


# ---------------------------------------------------------------------------
# Markup detection
# ---------------------------------------------------------------------------


def detect_mf_markup(implied_mf: Decimal, buy_rate_mf: Decimal) -> bool:
    """Return True if the dealer has marked up the Money Factor beyond the threshold.

    Formula (spec §6.1):
        markup detected  iff  (implied_mf − buy_rate_mf) > MARKUP_THRESHOLD

    The threshold (0.0004) corresponds to approximately +0.96% APR above the
    manufacturer's buy rate.  A delta equal to the threshold is NOT a markup
    (strictly-greater-than comparison).

    A negative delta (implied_mf < buy_rate_mf) always returns False.
    """
    return (implied_mf - buy_rate_mf) > MARKUP_THRESHOLD


# ---------------------------------------------------------------------------
# Buy-rate lookup
# ---------------------------------------------------------------------------


def get_buy_rate(
    make: str,
    model: str,
    trim: str | None,
    year: int,
    month_year: date,
) -> Decimal | None:
    """Return the manufacturer base Money Factor from the buy_rates table.

    Looks up the row matching (make, model, trim, year, month_year) and returns
    ``base_mf`` as a Decimal, or ``None`` when no matching row exists.

    When *trim* is None the query matches rows where the ``trim`` column is
    also NULL (NULL-safe comparison via ``IS NOT DISTINCT FROM``).

    All SQL parameters are passed as positional %s placeholders — no string
    interpolation is used (OWASP A03: Injection prevention).
    """
    sql = """
        SELECT base_mf
        FROM buy_rates
        WHERE make = %s
          AND model = %s
          AND trim IS NOT DISTINCT FROM %s
          AND year = %s
          AND month_year = %s
        LIMIT 1
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (make, model, trim, year, month_year))
            row = cur.fetchone()

    if row is None:
        return None

    return Decimal(str(row[0]))
