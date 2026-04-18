"""MPMR (Monthly Payment to MSRP Ratio) scoring module.

All arithmetic uses decimal.Decimal — no float.

Spec reference: §6.4 Monthly Payment to MSRP Ratio (MPMR) & Deal Quality
"""

from decimal import Decimal

# ---------------------------------------------------------------------------
# Bracket upper-inclusive boundaries (spec §6.4 code block)
# ---------------------------------------------------------------------------

_UNICORN_UPPER: Decimal = Decimal("0.0085")
_EXCELLENT_UPPER: Decimal = Decimal("0.0090")
_COMPETITIVE_UPPER: Decimal = Decimal("0.0100")
_AVERAGE_UPPER: Decimal = Decimal("0.0115")

# ---------------------------------------------------------------------------
# Calculator
# ---------------------------------------------------------------------------


def calculate_mpmr(emp: Decimal, msrp: Decimal) -> Decimal:
    """Return the Monthly Payment to MSRP Ratio (MPMR).

    Formula (spec §6.4):
        MPMR = EMP / MSRP

    The numerator **must** be EMP — not the advertised monthly payment.
    Result is quantized to 6 decimal places.
    """
    return (emp / msrp).quantize(Decimal("0.000001"))


# ---------------------------------------------------------------------------
# Score
# ---------------------------------------------------------------------------


def mpmr_score(mpmr: Decimal) -> int:
    """Map MPMR to a 0–100 efficiency score component (spec §6.4 / §6.5).

    Brackets:
        ≤ 0.0085 → 100  (Unicorn Deal)
        ≤ 0.0090 →  85  (Excellent Deal)
        ≤ 0.0100 →  70  (Competitive Deal)
        ≤ 0.0115 →  50  (Average Deal)
        > 0.0115 →  25  (Sub-Optimal Deal)
    """
    if mpmr <= _UNICORN_UPPER:
        return 100
    if mpmr <= _EXCELLENT_UPPER:
        return 85
    if mpmr <= _COMPETITIVE_UPPER:
        return 70
    if mpmr <= _AVERAGE_UPPER:
        return 50
    return 25


# ---------------------------------------------------------------------------
# Category label
# ---------------------------------------------------------------------------


def get_mpmr_category(mpmr: Decimal) -> str:
    """Return the deal quality category label for a given MPMR (spec §6.4).

    Uses the same bracket boundaries as :func:`mpmr_score`.
    """
    if mpmr <= _UNICORN_UPPER:
        return "Unicorn Deal"
    if mpmr <= _EXCELLENT_UPPER:
        return "Excellent Deal"
    if mpmr <= _COMPETITIVE_UPPER:
        return "Competitive Deal"
    if mpmr <= _AVERAGE_UPPER:
        return "Average Deal"
    return "Sub-Optimal Deal"
