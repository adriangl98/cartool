"""Unit tests for F04.2 — Texas Sales Tax Calculator.

All tests are pure (no database or network calls).
No float literals — every monetary value uses decimal.Decimal.
"""

from decimal import Decimal

import pytest

from app.tax import calculate_texas_tax, TX_SALES_TAX_RATE


class TestTexasTaxRate:
    def test_rate_constant_is_decimal(self) -> None:
        assert isinstance(TX_SALES_TAX_RATE, Decimal)
        assert TX_SALES_TAX_RATE == Decimal("0.0625")


class TestCalculateTexasTax:
    # ------------------------------------------------------------------
    # Test 1 — Standard calculation: $30,000 × 6.25% = $1,875.00
    # ------------------------------------------------------------------
    def test_standard_thirty_thousand(self) -> None:
        result = calculate_texas_tax(Decimal("30000.00"))
        assert result == Decimal("1875.00")

    # ------------------------------------------------------------------
    # Test 2 — Tax credit override: returns $0.00 regardless of price
    # ------------------------------------------------------------------
    def test_tax_credit_override_returns_zero(self) -> None:
        result = calculate_texas_tax(Decimal("30000.00"), tax_credit_flag=True)
        assert result == Decimal("0.00")

    def test_tax_credit_override_with_high_price(self) -> None:
        result = calculate_texas_tax(Decimal("75000.00"), tax_credit_flag=True)
        assert result == Decimal("0.00")

    # ------------------------------------------------------------------
    # Test 3 — Edge: $0 selling price returns $0.00
    # ------------------------------------------------------------------
    def test_zero_selling_price(self) -> None:
        result = calculate_texas_tax(Decimal("0.00"))
        assert result == Decimal("0.00")

    # ------------------------------------------------------------------
    # Test 4 — Precision: result is always rounded to the cent
    # ------------------------------------------------------------------
    def test_precision_rounds_to_cent(self) -> None:
        # $29,999.99 × 0.0625 = $1,874.999375 → rounds to $1,875.00
        result = calculate_texas_tax(Decimal("29999.99"))
        assert result == result.quantize(Decimal("0.01"))
        assert result == Decimal("1875.00")

    def test_precision_on_non_round_price(self) -> None:
        # $17,333.33 × 0.0625 = $1,083.333125 → rounds to $1,083.33
        result = calculate_texas_tax(Decimal("17333.33"))
        assert result == Decimal("1083.33")

    # ------------------------------------------------------------------
    # No float contamination guard
    # ------------------------------------------------------------------
    def test_return_type_is_decimal(self) -> None:
        result = calculate_texas_tax(Decimal("25000.00"))
        assert isinstance(result, Decimal)

    def test_return_type_is_decimal_with_credit_flag(self) -> None:
        result = calculate_texas_tax(Decimal("25000.00"), tax_credit_flag=True)
        assert isinstance(result, Decimal)
