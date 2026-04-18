"""Unit tests for F04.9 — Reverse Search Solver.

All tests are pure (no database or network calls).
No float literals — every monetary value uses decimal.Decimal.

Manual verification (spec §6.6 — standard case):
    desired_monthly = $550, down_payment = $2,500, term = 36 mo, APR = 5.3%
    r = 5.3 / 1200 ≈ 0.004417
    P = 550 × [1 − (1.004417)^(−36)] / 0.004417 ≈ $18,258
    total_outlay = $18,258 + $2,500 = $20,758
    max_price = ($20,758 − $1,045) / 1.0625 ≈ $18,565
"""

from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.reverse_search import (
    MARKET_AVG_APR,
    VALID_TERMS,
    ReverseSearchRequest,
    solve_max_selling_price,
)


# ---------------------------------------------------------------------------
# TestConstants
# ---------------------------------------------------------------------------


class TestConstants:
    def test_market_avg_apr_is_decimal(self) -> None:
        assert isinstance(MARKET_AVG_APR, Decimal)
        assert MARKET_AVG_APR == Decimal("5.3")

    def test_valid_terms_contains_expected_values(self) -> None:
        assert VALID_TERMS == frozenset({24, 36, 48, 60})


# ---------------------------------------------------------------------------
# TestSolveMaxSellingPrice — pure solver function
# ---------------------------------------------------------------------------


class TestSolveMaxSellingPrice:
    # ------------------------------------------------------------------
    # Test 1 — Known input/output (spec §6.6 standard case)
    # $550/mo, $2,500 down, 36 months, 5.3% APR
    # Expected max_selling_price ≈ $18,565 (reasonable range: $17,000–$20,000)
    # ------------------------------------------------------------------
    def test_standard_case_result_in_reasonable_range(self) -> None:
        result = solve_max_selling_price(
            desired_monthly=Decimal("550.00"),
            down_payment=Decimal("2500.00"),
            term_months=36,
            avg_apr=Decimal("5.3"),
        )
        assert isinstance(result, Decimal)
        assert Decimal("17000.00") <= result <= Decimal("20000.00"), (
            f"Expected $17,000–$20,000, got {result}"
        )

    def test_standard_case_result_quantized_to_cents(self) -> None:
        result = solve_max_selling_price(
            desired_monthly=Decimal("550.00"),
            down_payment=Decimal("2500.00"),
            term_months=36,
            avg_apr=Decimal("5.3"),
        )
        # Ensure result has exactly 2 decimal places
        assert result == result.quantize(Decimal("0.01"))

    # ------------------------------------------------------------------
    # Test 2 — Zero down payment
    # $550/mo, $0 down, 36 months, 5.3% APR
    # With no down payment, result should be lower than the standard case
    # Expected ≈ $16,200 (reasonable range: $14,000–$18,000)
    # ------------------------------------------------------------------
    def test_zero_down_payment(self) -> None:
        result = solve_max_selling_price(
            desired_monthly=Decimal("550.00"),
            down_payment=Decimal("0.00"),
            term_months=36,
            avg_apr=Decimal("5.3"),
        )
        assert isinstance(result, Decimal)
        assert Decimal("14000.00") <= result <= Decimal("18000.00"), (
            f"Expected $14,000–$18,000 with zero down, got {result}"
        )

    def test_zero_down_less_than_with_down(self) -> None:
        with_down = solve_max_selling_price(
            desired_monthly=Decimal("550.00"),
            down_payment=Decimal("2500.00"),
            term_months=36,
            avg_apr=Decimal("5.3"),
        )
        without_down = solve_max_selling_price(
            desired_monthly=Decimal("550.00"),
            down_payment=Decimal("0.00"),
            term_months=36,
            avg_apr=Decimal("5.3"),
        )
        assert without_down < with_down

    # ------------------------------------------------------------------
    # Test 3 — Maximally short term (24 months)
    # $550/mo, $0 down, 24 months, 5.3% APR
    # Shorter term → lower principal → lower max price
    # Expected ≈ $10,700 (reasonable range: $9,000–$13,000)
    # ------------------------------------------------------------------
    def test_24_month_term_returns_positive(self) -> None:
        result = solve_max_selling_price(
            desired_monthly=Decimal("550.00"),
            down_payment=Decimal("0.00"),
            term_months=24,
            avg_apr=Decimal("5.3"),
        )
        assert result > Decimal("0.00"), (
            f"24-month solver returned non-positive: {result}"
        )

    def test_24_month_term_in_reasonable_range(self) -> None:
        result = solve_max_selling_price(
            desired_monthly=Decimal("550.00"),
            down_payment=Decimal("0.00"),
            term_months=24,
            avg_apr=Decimal("5.3"),
        )
        assert Decimal("9000.00") <= result <= Decimal("13000.00"), (
            f"Expected $9,000–$13,000 for 24-month term, got {result}"
        )

    # ------------------------------------------------------------------
    # Test 4 — Result is never negative
    # Very small desired_monthly (budget barely covers fees) → clamp to $0
    # ------------------------------------------------------------------
    def test_tiny_budget_clamps_to_zero(self) -> None:
        # $10/mo, no down, 24 months — principal ≈ $237; after fees it's negative
        result = solve_max_selling_price(
            desired_monthly=Decimal("10.00"),
            down_payment=Decimal("0.00"),
            term_months=24,
            avg_apr=Decimal("5.3"),
        )
        assert result >= Decimal("0.00"), (
            f"Solver returned negative price: {result}"
        )

    def test_result_type_is_decimal(self) -> None:
        result = solve_max_selling_price(
            desired_monthly=Decimal("400.00"),
            down_payment=Decimal("1000.00"),
            term_months=48,
            avg_apr=Decimal("5.3"),
        )
        assert isinstance(result, Decimal)

    # ------------------------------------------------------------------
    # Higher monthly payment → higher max price (monotonic sanity check)
    # ------------------------------------------------------------------
    def test_higher_monthly_yields_higher_max_price(self) -> None:
        low = solve_max_selling_price(
            desired_monthly=Decimal("300.00"),
            down_payment=Decimal("0.00"),
            term_months=36,
            avg_apr=Decimal("5.3"),
        )
        high = solve_max_selling_price(
            desired_monthly=Decimal("700.00"),
            down_payment=Decimal("0.00"),
            term_months=36,
            avg_apr=Decimal("5.3"),
        )
        assert high > low


# ---------------------------------------------------------------------------
# TestReverseSearchRequestValidation — Pydantic model guards
# ---------------------------------------------------------------------------


class TestReverseSearchRequestValidation:
    # ------------------------------------------------------------------
    # Test 5 — Invalid term_months raises ValidationError
    # ------------------------------------------------------------------
    def test_invalid_term_raises_validation_error(self) -> None:
        with pytest.raises(ValidationError):
            ReverseSearchRequest(
                desired_monthly=Decimal("550.00"),
                down_payment=Decimal("2500.00"),
                term_months=99,
            )

    def test_term_12_raises_validation_error(self) -> None:
        with pytest.raises(ValidationError):
            ReverseSearchRequest(
                desired_monthly=Decimal("550.00"),
                down_payment=Decimal("0.00"),
                term_months=12,
            )

    def test_zero_desired_monthly_raises_validation_error(self) -> None:
        with pytest.raises(ValidationError):
            ReverseSearchRequest(
                desired_monthly=Decimal("0.00"),
                down_payment=Decimal("0.00"),
                term_months=36,
            )

    def test_negative_desired_monthly_raises_validation_error(self) -> None:
        with pytest.raises(ValidationError):
            ReverseSearchRequest(
                desired_monthly=Decimal("-100.00"),
                down_payment=Decimal("0.00"),
                term_months=36,
            )

    def test_negative_down_payment_raises_validation_error(self) -> None:
        with pytest.raises(ValidationError):
            ReverseSearchRequest(
                desired_monthly=Decimal("550.00"),
                down_payment=Decimal("-1.00"),
                term_months=36,
            )

    def test_valid_request_uses_default_apr(self) -> None:
        req = ReverseSearchRequest(
            desired_monthly=Decimal("550.00"),
            down_payment=Decimal("2500.00"),
            term_months=36,
        )
        assert req.avg_apr == MARKET_AVG_APR

    def test_all_valid_terms_are_accepted(self) -> None:
        for term in (24, 36, 48, 60):
            req = ReverseSearchRequest(
                desired_monthly=Decimal("400.00"),
                down_payment=Decimal("0.00"),
                term_months=term,
            )
            assert req.term_months == term
