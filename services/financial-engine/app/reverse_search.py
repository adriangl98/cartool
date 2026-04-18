"""Reverse Search Solver — F04.9.

Given user budget constraints, solves for the maximum vehicle selling price
that keeps EMP within the desired monthly payment.

Formula (spec §6.6):

    P = PMT × [1 − (1 + r)^(−n)] / r        (PV of ordinary annuity)

Where:
    r  = monthly interest rate = avg_apr / 1200
    n  = term_months
    P  = principal (present value of annuity / financed amount)

Back-calculation to selling price:

    max_selling_price = (P + down_payment − estimated_fees) / (1 + TX_TAX)

estimated_fees = DEFAULT_ACQUISITION_FEE + DEFAULT_DOC_FEE = $1,045.00

All arithmetic uses decimal.Decimal — no float.

Spec reference: §6.6 Reverse Search: Solving for Maximum Target Selling Price
Feature: F04.9
"""

from __future__ import annotations

from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_serializer, field_validator

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# 2026 Laredo market average APR (spec §6.6 — used when caller omits avg_apr)
MARKET_AVG_APR: Decimal = Decimal("5.3")

# Texas sales tax rate (spec §6.2)
_TX_SALES_TAX_RATE: Decimal = Decimal("0.0625")

# Default upfront fees: acquisition ($895) + doc ($150) — spec §6.3 defaults
_DEFAULT_FEES: Decimal = Decimal("1045.00")

# Allowed lease/finance terms (spec §6.6 validation requirement)
VALID_TERMS: frozenset[int] = frozenset({24, 36, 48, 60})

# ---------------------------------------------------------------------------
# Pydantic I/O models
# ---------------------------------------------------------------------------

_PositiveDecimal = Annotated[Decimal, Field(gt=Decimal("0"))]
_NonNegativeDecimal = Annotated[Decimal, Field(ge=Decimal("0"))]


class ReverseSearchRequest(BaseModel):
    """Input model for POST /solve — validated at the service boundary."""

    desired_monthly: _PositiveDecimal
    down_payment: _NonNegativeDecimal
    term_months: int
    avg_apr: Decimal = MARKET_AVG_APR

    @field_validator("term_months")
    @classmethod
    def term_must_be_valid(cls, v: int) -> int:
        if v not in VALID_TERMS:
            raise ValueError(
                f"term_months must be one of {sorted(VALID_TERMS)}, got {v}"
            )
        return v


class ReverseSearchResponse(BaseModel):
    """Output model for POST /solve."""

    max_selling_price: Decimal
    desired_monthly: Decimal
    down_payment: Decimal
    term_months: int
    avg_apr: Decimal

    @field_serializer("max_selling_price", "desired_monthly", "down_payment", "avg_apr")
    def serialize_decimal(self, value: Decimal) -> str:
        return str(value)


# ---------------------------------------------------------------------------
# Solver
# ---------------------------------------------------------------------------


def solve_max_selling_price(
    desired_monthly: Decimal,
    down_payment: Decimal,
    term_months: int,
    avg_apr: Decimal = MARKET_AVG_APR,
) -> Decimal:
    """Return the maximum adjusted selling price that keeps EMP within budget.

    Steps:
    1. Compute the monthly interest rate ``r = avg_apr / 1200``.
    2. Apply the PV-of-ordinary-annuity formula to find the financed principal
       ``P`` that produces ``desired_monthly`` over ``term_months``.
    3. Add ``down_payment`` to arrive at the total affordable outlay.
    4. Subtract default fees and divide by (1 + TX_TAX) to back-calculate the
       maximum vehicle selling price.

    The result is clamped to ≥ $0.00 so invalid budgets never surface a
    negative price.

    Args:
        desired_monthly: Target EMP; must be > 0.
        down_payment:    Cash down at signing; must be ≥ 0.
        term_months:     Loan/lease length; must be in {24, 36, 48, 60}.
        avg_apr:         Annual Percentage Rate as a percentage (e.g. 5.3 for
                         5.3%).  Defaults to the 2026 Laredo market average.

    Returns:
        Maximum adjusted selling price, quantized to the cent.
    """
    # Monthly interest rate (as a decimal fraction, not a percentage)
    r: Decimal = avg_apr / Decimal("1200")

    # PV of ordinary annuity: P = PMT × [1 − (1+r)^(−n)] / r
    # Decimal supports integer exponents including negative via ** operator.
    principal: Decimal = desired_monthly * (Decimal("1") - (Decimal("1") + r) ** (-term_months)) / r

    # Total purchasing power = financed principal + cash down
    # Back-calc: selling_price = (total_outlay − fees) / (1 + TX_TAX)
    total_outlay: Decimal = principal + down_payment
    max_price: Decimal = (total_outlay - _DEFAULT_FEES) / (Decimal("1") + _TX_SALES_TAX_RATE)

    # Clamp — solver must never return a negative price
    if max_price < Decimal("0"):
        max_price = Decimal("0")

    return max_price.quantize(Decimal("0.01"))
