from decimal import Decimal
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_serializer

import app.config  # noqa: F401 — validate env vars at startup
from app.obbba import (
    ANNUAL_DEDUCTION_CAP,
    TAX_BRACKETS,
    calculate_obbba_monthly_savings,
    get_listing_obbba_data,
    is_obbba_eligible,
)
from app.reverse_search import (
    ReverseSearchRequest,
    ReverseSearchResponse,
    solve_max_selling_price,
)

app = FastAPI(title="cartool financial-engine")


# ---------------------------------------------------------------------------
# Pydantic response models for GET /obbba/{listing_id}
# ---------------------------------------------------------------------------


class TaxBracketOption(BaseModel):
    bracket: str
    annual_savings: Decimal
    monthly_savings: Decimal

    @field_serializer("annual_savings", "monthly_savings")
    def serialize_decimal(self, value: Decimal) -> str:
        return str(value)


class ObbbaResponse(BaseModel):
    vehicle: str
    assembly_country: str
    assembly_plant: Optional[str]
    obbba_eligible: bool
    estimated_annual_interest: Decimal
    estimated_annual_deduction: Decimal
    tax_bracket_options: list[TaxBracketOption]

    @field_serializer("estimated_annual_interest", "estimated_annual_deduction")
    def serialize_decimal(self, value: Decimal) -> str:
        return str(value)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "financial-engine"}


@app.post("/solve", response_model=ReverseSearchResponse)
def solve(request: ReverseSearchRequest) -> ReverseSearchResponse:
    """Reverse Search Solver — spec §6.6 / F04.9.

    Given budget constraints, returns the maximum vehicle selling price that
    keeps the Effective Monthly Payment within ``desired_monthly``.
    """
    max_price = solve_max_selling_price(
        desired_monthly=request.desired_monthly,
        down_payment=request.down_payment,
        term_months=request.term_months,
        avg_apr=request.avg_apr,
    )
    return ReverseSearchResponse(
        max_selling_price=max_price,
        desired_monthly=request.desired_monthly,
        down_payment=request.down_payment,
        term_months=request.term_months,
        avg_apr=request.avg_apr,
    )


@app.get("/obbba/{listing_id}", response_model=ObbbaResponse)
def get_obbba(listing_id: str) -> ObbbaResponse:
    """OBBBA Federal Deduction Simulation — spec §10 / F04.10.

    Returns estimated federal interest deduction savings for all four tax
    brackets (22 %, 24 %, 32 %, 35 %) for a financed, US-assembled vehicle.
    Non-eligible listings (lease or foreign assembly) are returned with
    ``obbba_eligible = false`` and zero savings.
    """
    listing = get_listing_obbba_data(listing_id)
    if listing is None:
        raise HTTPException(status_code=404, detail="Listing not found")

    vehicle = f"{listing['year']} {listing['make']} {listing['model']}"
    if listing["trim"]:
        vehicle = f"{vehicle} {listing['trim']}"

    eligible = is_obbba_eligible(listing["assembly_country"], listing["transaction_type"])

    if not eligible or any(
        listing[k] is None
        for k in ("selling_price", "apr_percent", "loan_term_months")
    ):
        return ObbbaResponse(
            vehicle=vehicle,
            assembly_country=listing["assembly_country"],
            assembly_plant=listing["assembly_plant"],
            obbba_eligible=False,
            estimated_annual_interest=Decimal("0.00"),
            estimated_annual_deduction=Decimal("0.00"),
            tax_bracket_options=[],
        )

    loan_amount: Decimal = listing["selling_price"]
    apr: Decimal = listing["apr_percent"]
    term_months: int = listing["loan_term_months"]

    # Compute Year 1 interest via standard iterative amortization so that
    # estimated_annual_interest and estimated_annual_deduction are bracket-independent.
    monthly_rate = apr / Decimal("12") / Decimal("100")
    monthly_payment = loan_amount * monthly_rate / (
        1 - (1 + monthly_rate) ** (-term_months)
    )
    balance: Decimal = loan_amount
    year1_interest: Decimal = Decimal("0")
    for _ in range(12):
        interest_this_month = balance * monthly_rate
        year1_interest += interest_this_month
        balance -= monthly_payment - interest_this_month
    annual_deduction = min(year1_interest, ANNUAL_DEDUCTION_CAP)

    bracket_options = [
        TaxBracketOption(
            bracket=f"{int(b)}%",
            annual_savings=(annual_deduction * (b / Decimal("100"))).quantize(
                Decimal("0.01")
            ),
            monthly_savings=calculate_obbba_monthly_savings(
                loan_amount=loan_amount,
                apr=apr,
                tax_bracket_pct=b,
                term_months=term_months,
            ),
        )
        for b in TAX_BRACKETS
    ]

    return ObbbaResponse(
        vehicle=vehicle,
        assembly_country=listing["assembly_country"],
        assembly_plant=listing["assembly_plant"],
        obbba_eligible=True,
        estimated_annual_interest=year1_interest.quantize(Decimal("0.01")),
        estimated_annual_deduction=annual_deduction.quantize(Decimal("0.01")),
        tax_bracket_options=bracket_options,
    )
