"""Unit tests for F04.3 — EMP & TCOL Calculator.

All tests are pure (no database or network calls).
No float literals — every monetary value uses decimal.Decimal.

Manual verification (spec §6.3):
  Standard lease:
    TCOL = (349.00 × 36) + 0.00 + 895.00 + 150.00 + 1,881.25 = 15,490.25
    EMP  = 15,490.25 / 36 = 430.2847... → $430.28
  Tax credit lease (texas_tax = $0):
    TCOL = (349.00 × 36) + 0.00 + 895.00 + 150.00 + 0.00 = 13,609.00
    EMP  = 13,609.00 / 36 = 378.0277... → $378.03
"""

from decimal import Decimal

from app.emp import (
    DEFAULT_ACQUISITION_FEE,
    DEFAULT_DOC_FEE,
    calculate_emp,
    calculate_tcol,
)


class TestDefaultFeeConstants:
    def test_acquisition_fee_is_decimal(self) -> None:
        assert isinstance(DEFAULT_ACQUISITION_FEE, Decimal)
        assert DEFAULT_ACQUISITION_FEE == Decimal("895.00")

    def test_doc_fee_is_decimal(self) -> None:
        assert isinstance(DEFAULT_DOC_FEE, Decimal)
        assert DEFAULT_DOC_FEE == Decimal("150.00")


class TestCalculateTcol:
    # ------------------------------------------------------------------
    # Test 1 — Standard lease (spec §6.3 example values)
    # (349.00 × 36) + 0 + 895.00 + 150.00 + 1,881.25 = 15,490.25
    # ------------------------------------------------------------------
    def test_standard_lease(self) -> None:
        result = calculate_tcol(
            monthly_payment=Decimal("349.00"),
            term_months=36,
            due_at_signing=Decimal("0.00"),
            acquisition_fee=Decimal("895.00"),
            doc_fee=Decimal("150.00"),
            texas_tax=Decimal("1881.25"),
        )
        assert result == Decimal("15490.25")

    # ------------------------------------------------------------------
    # Test 2 — Zero down payment (due_at_signing = $0.00)
    # (450.00 × 36) + 0 + 895.00 + 150.00 + 1,500.00 = 18,745.00
    # ------------------------------------------------------------------
    def test_zero_due_at_signing(self) -> None:
        result = calculate_tcol(
            monthly_payment=Decimal("450.00"),
            term_months=36,
            due_at_signing=Decimal("0.00"),
            acquisition_fee=Decimal("895.00"),
            doc_fee=Decimal("150.00"),
            texas_tax=Decimal("1500.00"),
        )
        assert result == Decimal("18745.00")

    # ------------------------------------------------------------------
    # Test 3 — Tax credit applied: texas_tax = $0.00 is excluded from sum
    # (349.00 × 36) + 0 + 895.00 + 150.00 + 0.00 = 13,609.00
    # ------------------------------------------------------------------
    def test_tax_credit_zero_tax(self) -> None:
        result = calculate_tcol(
            monthly_payment=Decimal("349.00"),
            term_months=36,
            due_at_signing=Decimal("0.00"),
            acquisition_fee=Decimal("895.00"),
            doc_fee=Decimal("150.00"),
            texas_tax=Decimal("0.00"),
        )
        assert result == Decimal("13609.00")

    # ------------------------------------------------------------------
    # Test 4 — Default fee substitution
    # Passing None must yield the same result as passing the defaults explicitly
    # ------------------------------------------------------------------
    def test_none_fees_use_defaults(self) -> None:
        with_none = calculate_tcol(
            monthly_payment=Decimal("349.00"),
            term_months=36,
            due_at_signing=Decimal("0.00"),
            acquisition_fee=None,
            doc_fee=None,
            texas_tax=Decimal("1881.25"),
        )
        with_explicit = calculate_tcol(
            monthly_payment=Decimal("349.00"),
            term_months=36,
            due_at_signing=Decimal("0.00"),
            acquisition_fee=DEFAULT_ACQUISITION_FEE,
            doc_fee=DEFAULT_DOC_FEE,
            texas_tax=Decimal("1881.25"),
        )
        assert with_none == with_explicit

    # ------------------------------------------------------------------
    # Test 5 — Balloon finance uses the identical formula as a lease
    # (599.00 × 48) + 3,000 + 895 + 150 + 2,187.50 = 34,984.50
    # ------------------------------------------------------------------
    def test_balloon_finance_same_formula(self) -> None:
        result = calculate_tcol(
            monthly_payment=Decimal("599.00"),
            term_months=48,
            due_at_signing=Decimal("3000.00"),
            acquisition_fee=Decimal("895.00"),
            doc_fee=Decimal("150.00"),
            texas_tax=Decimal("2187.50"),
        )
        assert result == Decimal("34984.50")

    # ------------------------------------------------------------------
    # Test 6 — Result is always quantized to exactly 2 decimal places
    # ------------------------------------------------------------------
    def test_precision_two_decimal_places(self) -> None:
        result = calculate_tcol(
            monthly_payment=Decimal("349.99"),
            term_months=36,
            due_at_signing=Decimal("1500.00"),
            acquisition_fee=Decimal("895.00"),
            doc_fee=Decimal("150.00"),
            texas_tax=Decimal("1875.00"),
        )
        assert result == result.quantize(Decimal("0.01"))
        assert "." in str(result)
        assert len(str(result).split(".")[1]) == 2


class TestCalculateEmp:
    # ------------------------------------------------------------------
    # Test 1 — Standard lease (spec §6.3)
    # TCOL = 15,490.25 → EMP = 15,490.25 / 36 = 430.2847... → $430.28
    # ------------------------------------------------------------------
    def test_standard_lease(self) -> None:
        result = calculate_emp(
            monthly_payment=Decimal("349.00"),
            term_months=36,
            due_at_signing=Decimal("0.00"),
            acquisition_fee=Decimal("895.00"),
            doc_fee=Decimal("150.00"),
            texas_tax=Decimal("1881.25"),
        )
        assert result == Decimal("430.28")

    # ------------------------------------------------------------------
    # Test 2 — Zero down payment
    # TCOL = 18,745.00 → EMP = 18,745.00 / 36 = 520.6944... → $520.69
    # ------------------------------------------------------------------
    def test_zero_due_at_signing(self) -> None:
        result = calculate_emp(
            monthly_payment=Decimal("450.00"),
            term_months=36,
            due_at_signing=Decimal("0.00"),
            acquisition_fee=Decimal("895.00"),
            doc_fee=Decimal("150.00"),
            texas_tax=Decimal("1500.00"),
        )
        assert result == Decimal("520.69")

    # ------------------------------------------------------------------
    # Test 3 — Tax credit applied (texas_tax = $0.00)
    # TCOL = 13,609.00 → EMP = 13,609.00 / 36 = 378.0277... → $378.03
    # ------------------------------------------------------------------
    def test_tax_credit_zero_tax(self) -> None:
        result = calculate_emp(
            monthly_payment=Decimal("349.00"),
            term_months=36,
            due_at_signing=Decimal("0.00"),
            acquisition_fee=Decimal("895.00"),
            doc_fee=Decimal("150.00"),
            texas_tax=Decimal("0.00"),
        )
        assert result == Decimal("378.03")

    # ------------------------------------------------------------------
    # Test 4 — Default fee substitution (acquisition_fee=None, doc_fee=None)
    # ------------------------------------------------------------------
    def test_none_fees_use_defaults(self) -> None:
        with_none = calculate_emp(
            monthly_payment=Decimal("349.00"),
            term_months=36,
            due_at_signing=Decimal("0.00"),
            acquisition_fee=None,
            doc_fee=None,
            texas_tax=Decimal("1881.25"),
        )
        with_explicit = calculate_emp(
            monthly_payment=Decimal("349.00"),
            term_months=36,
            due_at_signing=Decimal("0.00"),
            acquisition_fee=DEFAULT_ACQUISITION_FEE,
            doc_fee=DEFAULT_DOC_FEE,
            texas_tax=Decimal("1881.25"),
        )
        assert with_none == with_explicit

    # ------------------------------------------------------------------
    # Test 5 — Balloon finance uses the identical formula as a lease
    # TCOL = 34,984.50 → EMP = 34,984.50 / 48 = 728.84375 → $728.84
    # ------------------------------------------------------------------
    def test_balloon_finance_same_formula(self) -> None:
        result = calculate_emp(
            monthly_payment=Decimal("599.00"),
            term_months=48,
            due_at_signing=Decimal("3000.00"),
            acquisition_fee=Decimal("895.00"),
            doc_fee=Decimal("150.00"),
            texas_tax=Decimal("2187.50"),
        )
        assert result == Decimal("728.84")

    # ------------------------------------------------------------------
    # Test 6 — Result is always quantized to exactly 2 decimal places
    # ------------------------------------------------------------------
    def test_precision_two_decimal_places(self) -> None:
        result = calculate_emp(
            monthly_payment=Decimal("349.00"),
            term_months=36,
            due_at_signing=Decimal("0.00"),
            acquisition_fee=Decimal("895.00"),
            doc_fee=Decimal("150.00"),
            texas_tax=Decimal("1881.25"),
        )
        assert result == result.quantize(Decimal("0.01"))

    # ------------------------------------------------------------------
    # Test 7 — EMP is always ≤ TCOL (term_months ≥ 1 invariant)
    # ------------------------------------------------------------------
    def test_emp_less_than_or_equal_to_tcol(self) -> None:
        kwargs = dict(
            monthly_payment=Decimal("349.00"),
            term_months=36,
            due_at_signing=Decimal("0.00"),
            acquisition_fee=Decimal("895.00"),
            doc_fee=Decimal("150.00"),
            texas_tax=Decimal("1881.25"),
        )
        tcol = calculate_tcol(**kwargs)
        emp = calculate_emp(**kwargs)
        assert emp <= tcol
