"""Unit tests for F04.5 — MPMR Scoring.

All tests are pure (no database or network calls).
No float literals — every value uses decimal.Decimal.

Spec reference: §6.4 Monthly Payment to MSRP Ratio (MPMR) & Deal Quality

Boundary note:
  The brackets are upper-inclusive, meaning a value exactly equal to the
  upper boundary falls into that bracket (not the one above it).
  For example, MPMR == Decimal("0.0085") → score 100, category "Unicorn Deal".
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.mpmr import (
    calculate_mpmr,
    get_mpmr_category,
    mpmr_score,
    _UNICORN_UPPER,
    _EXCELLENT_UPPER,
    _COMPETITIVE_UPPER,
    _AVERAGE_UPPER,
)


# ---------------------------------------------------------------------------
# Threshold constants
# ---------------------------------------------------------------------------


class TestThresholdConstants:
    def test_unicorn_upper_value(self) -> None:
        assert _UNICORN_UPPER == Decimal("0.0085")

    def test_excellent_upper_value(self) -> None:
        assert _EXCELLENT_UPPER == Decimal("0.0090")

    def test_competitive_upper_value(self) -> None:
        assert _COMPETITIVE_UPPER == Decimal("0.0100")

    def test_average_upper_value(self) -> None:
        assert _AVERAGE_UPPER == Decimal("0.0115")

    def test_all_constants_are_decimal(self) -> None:
        for constant in (_UNICORN_UPPER, _EXCELLENT_UPPER, _COMPETITIVE_UPPER, _AVERAGE_UPPER):
            assert isinstance(constant, Decimal)


# ---------------------------------------------------------------------------
# calculate_mpmr
# ---------------------------------------------------------------------------


class TestCalculateMpmr:
    # ------------------------------------------------------------------
    # Test 1 — Standard case: spec example EMP $430.28 / MSRP $45,000
    # 430.28 / 45000 = 0.009561... → 6 decimal places
    # ------------------------------------------------------------------
    def test_standard_case(self) -> None:
        result = calculate_mpmr(Decimal("430.28"), Decimal("45000.00"))
        assert result == Decimal("0.009562")

    # ------------------------------------------------------------------
    # Test 2 — Unicorn-calibre deal: EMP $382.50 / MSRP $45,000
    # 382.50 / 45000 = 0.008500
    # ------------------------------------------------------------------
    def test_unicorn_boundary_value(self) -> None:
        result = calculate_mpmr(Decimal("382.50"), Decimal("45000.00"))
        assert result == Decimal("0.008500")

    # ------------------------------------------------------------------
    # Test 3 — Zero EMP returns 0.000000
    # ------------------------------------------------------------------
    def test_zero_emp(self) -> None:
        result = calculate_mpmr(Decimal("0.00"), Decimal("40000.00"))
        assert result == Decimal("0.000000")

    # ------------------------------------------------------------------
    # Test 4 — Precision: result always has exactly 6 decimal places
    # ------------------------------------------------------------------
    def test_result_precision_is_six_decimals(self) -> None:
        result = calculate_mpmr(Decimal("399.00"), Decimal("38000.00"))
        assert result == result.quantize(Decimal("0.000001"))

    # ------------------------------------------------------------------
    # Test 5 — Result type is Decimal (no float contamination)
    # ------------------------------------------------------------------
    def test_result_is_decimal(self) -> None:
        result = calculate_mpmr(Decimal("400.00"), Decimal("40000.00"))
        assert isinstance(result, Decimal)

    # ------------------------------------------------------------------
    # Test 6 — EMP equals MSRP → MPMR is exactly 1.000000
    # ------------------------------------------------------------------
    def test_emp_equals_msrp(self) -> None:
        result = calculate_mpmr(Decimal("50000.00"), Decimal("50000.00"))
        assert result == Decimal("1.000000")


# ---------------------------------------------------------------------------
# mpmr_score  — 5 bracket interiors + 4 exact boundary values
# ---------------------------------------------------------------------------


class TestMpmrScore:
    # ------------------------------------------------------------------
    # Bracket 1: ≤ 0.0085 → 100  (Unicorn Deal)
    # ------------------------------------------------------------------
    def test_unicorn_interior(self) -> None:
        assert mpmr_score(Decimal("0.0070")) == 100

    def test_unicorn_upper_boundary(self) -> None:
        """Exactly 0.0085 must still score 100 (upper-inclusive)."""
        assert mpmr_score(Decimal("0.0085")) == 100

    # ------------------------------------------------------------------
    # Bracket 2: 0.0086 – 0.0090 → 85  (Excellent Deal)
    # ------------------------------------------------------------------
    def test_excellent_interior(self) -> None:
        assert mpmr_score(Decimal("0.0088")) == 85

    def test_excellent_upper_boundary(self) -> None:
        """Exactly 0.0090 must score 85."""
        assert mpmr_score(Decimal("0.0090")) == 85

    # ------------------------------------------------------------------
    # Bracket 3: 0.0091 – 0.0100 → 70  (Competitive Deal)
    # ------------------------------------------------------------------
    def test_competitive_interior(self) -> None:
        assert mpmr_score(Decimal("0.0095")) == 70

    def test_competitive_upper_boundary(self) -> None:
        """Exactly 0.0100 must score 70."""
        assert mpmr_score(Decimal("0.0100")) == 70

    # ------------------------------------------------------------------
    # Bracket 4: 0.0101 – 0.0115 → 50  (Average Deal)
    # ------------------------------------------------------------------
    def test_average_interior(self) -> None:
        assert mpmr_score(Decimal("0.0110")) == 50

    def test_average_upper_boundary(self) -> None:
        """Exactly 0.0115 must score 50."""
        assert mpmr_score(Decimal("0.0115")) == 50

    # ------------------------------------------------------------------
    # Bracket 5: > 0.0115 → 25  (Sub-Optimal Deal)
    # ------------------------------------------------------------------
    def test_suboptimal_just_above_boundary(self) -> None:
        """0.0116 is one step above the Average upper boundary → 25."""
        assert mpmr_score(Decimal("0.0116")) == 25

    def test_suboptimal_high_value(self) -> None:
        assert mpmr_score(Decimal("0.0200")) == 25

    # ------------------------------------------------------------------
    # Return type is always int
    # ------------------------------------------------------------------
    def test_return_type_is_int(self) -> None:
        assert isinstance(mpmr_score(Decimal("0.0100")), int)


# ---------------------------------------------------------------------------
# get_mpmr_category  — mirrors mpmr_score bracket structure
# ---------------------------------------------------------------------------


class TestGetMpmrCategory:
    # ------------------------------------------------------------------
    # Bracket 1: ≤ 0.0085 → "Unicorn Deal"
    # ------------------------------------------------------------------
    def test_unicorn_interior(self) -> None:
        assert get_mpmr_category(Decimal("0.0070")) == "Unicorn Deal"

    def test_unicorn_upper_boundary(self) -> None:
        assert get_mpmr_category(Decimal("0.0085")) == "Unicorn Deal"

    # ------------------------------------------------------------------
    # Bracket 2: 0.0086 – 0.0090 → "Excellent Deal"
    # ------------------------------------------------------------------
    def test_excellent_interior(self) -> None:
        assert get_mpmr_category(Decimal("0.0088")) == "Excellent Deal"

    def test_excellent_upper_boundary(self) -> None:
        assert get_mpmr_category(Decimal("0.0090")) == "Excellent Deal"

    # ------------------------------------------------------------------
    # Bracket 3: 0.0091 – 0.0100 → "Competitive Deal"
    # ------------------------------------------------------------------
    def test_competitive_interior(self) -> None:
        assert get_mpmr_category(Decimal("0.0095")) == "Competitive Deal"

    def test_competitive_upper_boundary(self) -> None:
        assert get_mpmr_category(Decimal("0.0100")) == "Competitive Deal"

    # ------------------------------------------------------------------
    # Bracket 4: 0.0101 – 0.0115 → "Average Deal"
    # ------------------------------------------------------------------
    def test_average_interior(self) -> None:
        assert get_mpmr_category(Decimal("0.0110")) == "Average Deal"

    def test_average_upper_boundary(self) -> None:
        assert get_mpmr_category(Decimal("0.0115")) == "Average Deal"

    # ------------------------------------------------------------------
    # Bracket 5: > 0.0115 → "Sub-Optimal Deal"
    # ------------------------------------------------------------------
    def test_suboptimal_just_above_boundary(self) -> None:
        assert get_mpmr_category(Decimal("0.0116")) == "Sub-Optimal Deal"

    def test_suboptimal_high_value(self) -> None:
        assert get_mpmr_category(Decimal("0.0200")) == "Sub-Optimal Deal"

    # ------------------------------------------------------------------
    # Return type is str
    # ------------------------------------------------------------------
    def test_return_type_is_str(self) -> None:
        assert isinstance(get_mpmr_category(Decimal("0.0100")), str)
