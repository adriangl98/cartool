"""EMP (Effective Monthly Payment) and TCOL (Total Cost of Lease) calculator.

All arithmetic uses decimal.Decimal — no float.

Spec reference: §6.3 Total Cost of Lease (TCOL) & Effective Monthly Payment (EMP)
"""

from decimal import Decimal

DEFAULT_ACQUISITION_FEE = Decimal("895.00")
DEFAULT_DOC_FEE = Decimal("150.00")


def calculate_tcol(
    monthly_payment: Decimal,
    term_months: int,
    due_at_signing: Decimal,
    acquisition_fee: Decimal | None,
    doc_fee: Decimal | None,
    texas_tax: Decimal,
) -> Decimal:
    """Return the Total Cost of Lease (TCOL).

    When *acquisition_fee* or *doc_fee* is None (not found in the scrape),
    the module-level defaults are substituted automatically.

    Formula (spec §6.3):
        TCOL = (monthly_payment × term_months) + due_at_signing
               + acquisition_fee + doc_fee + texas_tax

    Result is quantized to the cent (2 decimal places).
    """
    acq = acquisition_fee if acquisition_fee is not None else DEFAULT_ACQUISITION_FEE
    doc = doc_fee if doc_fee is not None else DEFAULT_DOC_FEE
    total = (
        (monthly_payment * Decimal(term_months))
        + due_at_signing
        + acq
        + doc
        + texas_tax
    )
    return total.quantize(Decimal("0.01"))


def calculate_emp(
    monthly_payment: Decimal,
    term_months: int,
    due_at_signing: Decimal,
    acquisition_fee: Decimal | None,
    doc_fee: Decimal | None,
    texas_tax: Decimal,
) -> Decimal:
    """Return the Effective Monthly Payment (EMP).

    EMP amortises all upfront costs over the lease term so payments from
    different deals are comparable on a like-for-like basis.  Always use EMP
    — never the contract monthly payment alone — for deal comparisons.

    Formula (spec §6.3):
        EMP = TCOL / term_months

    Result is quantized to the cent (2 decimal places).
    """
    tcol = calculate_tcol(
        monthly_payment,
        term_months,
        due_at_signing,
        acquisition_fee,
        doc_fee,
        texas_tax,
    )
    return (tcol / Decimal(term_months)).quantize(Decimal("0.01"))
