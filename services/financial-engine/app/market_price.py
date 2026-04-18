"""Market Price Score module.

Compares a listing's addon_adjusted_price against the rolling 30-day
regional average for the same (make, model, trim, year) to produce a
market price score component.

All arithmetic uses decimal.Decimal — no float.

Spec reference: §6.5 Deal Score — Market Price Score
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional

from app.db import get_connection

# ---------------------------------------------------------------------------
# Boundary constants (spec §6.5)
# ---------------------------------------------------------------------------

_BELOW_MARKET_UPPER: Decimal = Decimal("0.95")
_AT_MARKET_UPPER: Decimal = Decimal("1.00")
_SLIGHT_ABOVE_UPPER: Decimal = Decimal("1.05")

# Minimum number of comparable listings required to produce a meaningful average
_MIN_COMPARABLES: int = 3


# ---------------------------------------------------------------------------
# Database query
# ---------------------------------------------------------------------------


def get_regional_avg(make: str, model: str, trim: str, year: int) -> Optional[Decimal]:
    """Return the rolling 30-day average addon_adjusted_price for a vehicle spec.

    Queries the ``listings`` table using a fully parameterized statement —
    no string interpolation of make/model/trim/year.

    Returns ``None`` when fewer than :data:`_MIN_COMPARABLES` (3) comparable
    listings exist in the window, signalling insufficient data.
    """
    sql = """
        SELECT
            COUNT(*)               AS cnt,
            AVG(addon_adjusted_price) AS avg_price
        FROM listings
        WHERE
            make  = %s
            AND model = %s
            AND trim  = %s
            AND year  = %s
            AND scraped_at >= NOW() - INTERVAL '30 days'
            AND addon_adjusted_price IS NOT NULL
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (make, model, trim, year))
            row = cur.fetchone()

    if row is None:
        return None

    cnt, avg_price = row
    if cnt < _MIN_COMPARABLES or avg_price is None:
        return None

    return Decimal(str(avg_price)).quantize(Decimal("0.01"))


# ---------------------------------------------------------------------------
# Score
# ---------------------------------------------------------------------------


def market_price_score(
    dealer_price: Decimal,
    regional_avg: Optional[Decimal],
) -> int:
    """Return the market price score component (0–100).

    When ``regional_avg`` is ``None`` (insufficient comparable data),
    returns the neutral default of 60 per spec §6.5.

    Score bands (spec §6.5):
        dealer / avg ≤ 0.95  → 100  (well below market)
        dealer / avg ≤ 1.00  → 80   (at or below market)
        dealer / avg ≤ 1.05  → 60   (slightly above market)
        dealer / avg > 1.05  → 20   (above market)
    """
    if regional_avg is None:
        return 60

    ratio = dealer_price / regional_avg

    if ratio <= _BELOW_MARKET_UPPER:
        return 100
    if ratio <= _AT_MARKET_UPPER:
        return 80
    if ratio <= _SLIGHT_ABOVE_UPPER:
        return 60
    return 20
