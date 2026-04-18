"""OBBBA Federal Deduction Module — F04.10.

Calculates estimated federal interest deduction savings for US-assembled
financed vehicles under the One Big Beautiful Bill Act (OBBBA), effective
2026 tax year.

All arithmetic uses decimal.Decimal — no float.

Spec reference: §10 OBBBA Federal Deduction Module
Feature: F04.10
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional

from app.db import get_connection

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Annual interest deduction cap (spec §10.1)
ANNUAL_DEDUCTION_CAP: Decimal = Decimal("10000.00")

# Four tax bracket options surfaced in the spec §7 response
TAX_BRACKETS: tuple[Decimal, ...] = (
    Decimal("22"),
    Decimal("24"),
    Decimal("32"),
    Decimal("35"),
)


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------


def is_obbba_eligible(assembly_country: str, transaction_type: str) -> bool:
    """Return True if the vehicle/transaction qualifies for OBBBA deduction.

    Per spec §10.1:
    - ``assembly_country`` must be ``'US'``
    - ``transaction_type`` must be ``'finance'`` (not ``'lease'`` or ``'balloon'``)
    """
    return assembly_country == "US" and transaction_type == "finance"


# ---------------------------------------------------------------------------
# Calculation
# ---------------------------------------------------------------------------


def calculate_obbba_monthly_savings(
    loan_amount: Decimal,
    apr: Decimal,
    tax_bracket_pct: Decimal,
    term_months: int,
) -> Decimal:
    """Approximate monthly federal interest deduction savings for Year 1.

    Approximates average monthly interest for Year 1 using simple amortization,
    then applies the marginal tax rate.  Annual deductible is capped at
    :data:`ANNUAL_DEDUCTION_CAP` ($10,000) per spec §10.1.

    Formula (spec §10.2)::

        monthly_rate    = apr / 12 / 100
        monthly_payment = loan_amount * monthly_rate
                          / (1 - (1 + monthly_rate) ** (-term_months))
        year1_interest  = sum(
            loan_amount * monthly_rate
            - (monthly_payment - loan_amount * monthly_rate) * i
            for i in range(12)
        )
        annual_deductible = min(year1_interest, 10_000)
        annual_savings    = annual_deductible * (tax_bracket_pct / 100)
        monthly_savings   = (annual_savings / 12).quantize("0.01")

    Args:
        loan_amount: Principal of the finance loan (Decimal, USD).
        apr: Annual Percentage Rate as a percentage, e.g. ``Decimal("5.3")``
            for 5.3 %.
        tax_bracket_pct: Marginal tax rate as a percentage, e.g.
            ``Decimal("22")`` for 22 %.
        term_months: Loan term in months (e.g. 36, 48, 60).

    Returns:
        Estimated monthly tax savings rounded to 2 decimal places.
    """
    monthly_rate: Decimal = apr / Decimal("12") / Decimal("100")
    monthly_payment: Decimal = (
        loan_amount * monthly_rate / (1 - (1 + monthly_rate) ** (-term_months))
    )

    # Compute Year 1 interest via standard iterative amortization.
    # The spec §10.2 formula is a linear approximation that omits the monthly_rate
    # factor on the principal term, producing negative values for typical auto loans.
    # Iterative amortization is the correct equivalent.
    balance: Decimal = loan_amount
    year1_interest: Decimal = Decimal("0")
    for _ in range(12):
        interest: Decimal = balance * monthly_rate
        year1_interest += interest
        balance -= monthly_payment - interest

    annual_deductible: Decimal = min(year1_interest, ANNUAL_DEDUCTION_CAP)
    annual_savings: Decimal = annual_deductible * (tax_bracket_pct / Decimal("100"))
    return (annual_savings / Decimal("12")).quantize(Decimal("0.01"))


# ---------------------------------------------------------------------------
# Database query
# ---------------------------------------------------------------------------


def get_listing_obbba_data(listing_id: str) -> Optional[dict]:
    """Fetch the listing fields required for OBBBA computation.

    Uses a fully parameterized statement — no string interpolation.

    Returns ``None`` if no listing with the given ``listing_id`` exists.
    """
    sql = """
        SELECT
            year,
            make,
            model,
            trim,
            assembly_country,
            assembly_plant,
            transaction_type,
            selling_price,
            apr_percent,
            loan_term_months
        FROM listings
        WHERE id = %s
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (listing_id,))
            row = cur.fetchone()

    if row is None:
        return None

    (
        year,
        make,
        model,
        trim,
        assembly_country,
        assembly_plant,
        transaction_type,
        selling_price,
        apr_percent,
        loan_term_months,
    ) = row

    return {
        "year": year,
        "make": make,
        "model": model,
        "trim": trim or "",
        "assembly_country": assembly_country or "",
        "assembly_plant": assembly_plant,
        "transaction_type": transaction_type,
        "selling_price": (
            Decimal(str(selling_price)) if selling_price is not None else None
        ),
        "apr_percent": (
            Decimal(str(apr_percent)) if apr_percent is not None else None
        ),
        "loan_term_months": loan_term_months,
    }
