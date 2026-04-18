"""Texas sales tax calculation module.

All arithmetic uses decimal.Decimal — no float.
"""

from decimal import Decimal

TX_SALES_TAX_RATE = Decimal("0.0625")


def calculate_texas_tax(
    adjusted_selling_price: Decimal,
    tax_credit_flag: bool = False,
) -> Decimal:
    """Return Texas 6.25% sales tax on the full adjusted selling price.

    If *tax_credit_flag* is True the vehicle qualifies for a trade-in tax
    credit and no tax is owed; returns Decimal("0.00") immediately.

    Result is always quantized to the cent (2 decimal places, ROUND_HALF_UP).
    """
    if tax_credit_flag:
        return Decimal("0.00")
    return (adjusted_selling_price * TX_SALES_TAX_RATE).quantize(Decimal("0.01"))
