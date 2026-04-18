"""Unit tests for F04.6 — Market Price Score.

All tests are pure (no database or network calls).
get_connection is mocked via unittest.mock.patch for the DB-touching function.
No float literals — every value uses decimal.Decimal.

Spec reference: §6.5 Deal Score — Market Price Score

Score bands:
    ratio ≤ 0.95  → 100  (well below market)
    ratio ≤ 1.00  → 80   (at or below market)
    ratio ≤ 1.05  → 60   (slightly above market)
    ratio > 1.05  → 20   (above market)
    regional_avg is None → 60  (neutral default)
"""

from __future__ import annotations

from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest

from app.market_price import (
    _AT_MARKET_UPPER,
    _BELOW_MARKET_UPPER,
    _MIN_COMPARABLES,
    _SLIGHT_ABOVE_UPPER,
    get_regional_avg,
    market_price_score,
)


# ---------------------------------------------------------------------------
# Threshold constants
# ---------------------------------------------------------------------------


class TestThresholdConstants:
    def test_below_market_upper_value(self) -> None:
        assert _BELOW_MARKET_UPPER == Decimal("0.95")

    def test_at_market_upper_value(self) -> None:
        assert _AT_MARKET_UPPER == Decimal("1.00")

    def test_slight_above_upper_value(self) -> None:
        assert _SLIGHT_ABOVE_UPPER == Decimal("1.05")

    def test_min_comparables_value(self) -> None:
        assert _MIN_COMPARABLES == 3

    def test_all_boundary_constants_are_decimal(self) -> None:
        for constant in (_BELOW_MARKET_UPPER, _AT_MARKET_UPPER, _SLIGHT_ABOVE_UPPER):
            assert isinstance(constant, Decimal)


# ---------------------------------------------------------------------------
# market_price_score — score bands
# ---------------------------------------------------------------------------


class TestMarketPriceScore:
    # ------------------------------------------------------------------
    # Test 1 — Band: ratio <= 0.95 → 100 (well below market)
    # dealer_price = $38,000 / regional_avg = $40,000 = 0.950 (boundary)
    # ------------------------------------------------------------------
    def test_well_below_market_boundary(self) -> None:
        result = market_price_score(Decimal("38000.00"), Decimal("40000.00"))
        assert result == 100

    # ------------------------------------------------------------------
    # Test 2 — Band interior: ratio = 0.90 → 100
    # dealer_price = $36,000 / regional_avg = $40,000
    # ------------------------------------------------------------------
    def test_well_below_market_interior(self) -> None:
        result = market_price_score(Decimal("36000.00"), Decimal("40000.00"))
        assert result == 100

    # ------------------------------------------------------------------
    # Test 3 — Band: ratio <= 1.00 → 80 (at or below market)
    # dealer_price = $40,000 / regional_avg = $40,000 = 1.000 (boundary)
    # ------------------------------------------------------------------
    def test_at_market_boundary(self) -> None:
        result = market_price_score(Decimal("40000.00"), Decimal("40000.00"))
        assert result == 80

    # ------------------------------------------------------------------
    # Test 4 — Band interior: ratio = 0.97 → 80
    # dealer_price = $38,800 / regional_avg = $40,000
    # ------------------------------------------------------------------
    def test_at_market_interior(self) -> None:
        result = market_price_score(Decimal("38800.00"), Decimal("40000.00"))
        assert result == 80

    # ------------------------------------------------------------------
    # Test 5 — Band: ratio <= 1.05 → 60 (slightly above market)
    # dealer_price = $42,000 / regional_avg = $40,000 = 1.05 (boundary)
    # ------------------------------------------------------------------
    def test_slightly_above_market_boundary(self) -> None:
        result = market_price_score(Decimal("42000.00"), Decimal("40000.00"))
        assert result == 60

    # ------------------------------------------------------------------
    # Test 6 — Band interior: ratio = 1.02 → 60
    # dealer_price = $40,800 / regional_avg = $40,000
    # ------------------------------------------------------------------
    def test_slightly_above_market_interior(self) -> None:
        result = market_price_score(Decimal("40800.00"), Decimal("40000.00"))
        assert result == 60

    # ------------------------------------------------------------------
    # Test 7 — Band: ratio > 1.05 → 20 (above market)
    # dealer_price = $45,000 / regional_avg = $40,000 = 1.125
    # ------------------------------------------------------------------
    def test_above_market(self) -> None:
        result = market_price_score(Decimal("45000.00"), Decimal("40000.00"))
        assert result == 20

    # ------------------------------------------------------------------
    # Test 8 — None regional_avg → neutral default of 60
    # ------------------------------------------------------------------
    def test_none_regional_avg_returns_neutral_score(self) -> None:
        result = market_price_score(Decimal("40000.00"), None)
        assert result == 60

    # ------------------------------------------------------------------
    # Test 9 — Return type is int for all branches
    # ------------------------------------------------------------------
    def test_return_type_is_int(self) -> None:
        for price, avg, expected in [
            (Decimal("38000.00"), Decimal("40000.00"), 100),
            (Decimal("39000.00"), Decimal("40000.00"), 80),
            (Decimal("41000.00"), Decimal("40000.00"), 60),
            (Decimal("46000.00"), Decimal("40000.00"), 20),
        ]:
            result = market_price_score(price, avg)
            assert isinstance(result, int), f"Expected int, got {type(result)}"


# ---------------------------------------------------------------------------
# get_regional_avg — DB mocking
# ---------------------------------------------------------------------------


class TestGetRegionalAvg:
    # ------------------------------------------------------------------
    # Test 10 — Sufficient data → returns Decimal average
    # ------------------------------------------------------------------
    def test_returns_decimal_when_sufficient_comparables(self) -> None:
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_cur.__enter__ = MagicMock(return_value=mock_cur)
        mock_cur.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value = mock_cur
        # Simulate COUNT=5, AVG=40000.50
        mock_cur.fetchone.return_value = (5, 40000.50)

        with patch("app.market_price.get_connection", return_value=mock_conn):
            result = get_regional_avg("Toyota", "Camry", "XSE", 2025)

        assert result == Decimal("40000.50")
        assert isinstance(result, Decimal)

    # ------------------------------------------------------------------
    # Test 11 — Fewer than 3 comparables → returns None
    # ------------------------------------------------------------------
    def test_returns_none_when_insufficient_comparables(self) -> None:
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_cur.__enter__ = MagicMock(return_value=mock_cur)
        mock_cur.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value = mock_cur
        # Simulate only 2 comparables
        mock_cur.fetchone.return_value = (2, 38500.00)

        with patch("app.market_price.get_connection", return_value=mock_conn):
            result = get_regional_avg("Toyota", "Camry", "XSE", 2025)

        assert result is None

    # ------------------------------------------------------------------
    # Test 12 — Zero rows returned → returns None
    # ------------------------------------------------------------------
    def test_returns_none_when_no_rows(self) -> None:
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_cur.__enter__ = MagicMock(return_value=mock_cur)
        mock_cur.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value = mock_cur
        mock_cur.fetchone.return_value = None

        with patch("app.market_price.get_connection", return_value=mock_conn):
            result = get_regional_avg("Ford", "F-150", "Lariat", 2024)

        assert result is None

    # ------------------------------------------------------------------
    # Test 13 — AVG is None (all prices NULL) with count >= 3 → returns None
    # ------------------------------------------------------------------
    def test_returns_none_when_avg_is_null(self) -> None:
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_cur.__enter__ = MagicMock(return_value=mock_cur)
        mock_cur.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value = mock_cur
        # count=4 but avg=None (shouldn't happen with our WHERE clause, but guard anyway)
        mock_cur.fetchone.return_value = (4, None)

        with patch("app.market_price.get_connection", return_value=mock_conn):
            result = get_regional_avg("BMW", "X5", "xDrive40i", 2026)

        assert result is None

    # ------------------------------------------------------------------
    # Test 14 — Exactly 3 comparables → sufficient (boundary)
    # ------------------------------------------------------------------
    def test_exactly_three_comparables_is_sufficient(self) -> None:
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_cur.__enter__ = MagicMock(return_value=mock_cur)
        mock_cur.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value = mock_cur
        mock_cur.fetchone.return_value = (3, 35000.00)

        with patch("app.market_price.get_connection", return_value=mock_conn):
            result = get_regional_avg("Honda", "CR-V", "EX-L", 2025)

        assert result == Decimal("35000.00")
        assert result is not None

    # ------------------------------------------------------------------
    # Test 15 — Parameterized SQL: cursor.execute called with tuple args
    # ------------------------------------------------------------------
    def test_query_is_parameterized(self) -> None:
        mock_conn = MagicMock()
        mock_cur = MagicMock()
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)
        mock_cur.__enter__ = MagicMock(return_value=mock_cur)
        mock_cur.__exit__ = MagicMock(return_value=False)
        mock_conn.cursor.return_value = mock_cur
        mock_cur.fetchone.return_value = (5, 42000.00)

        with patch("app.market_price.get_connection", return_value=mock_conn):
            get_regional_avg("Chevrolet", "Equinox", "LT", 2026)

        # Verify execute was called with positional parameters, not string format
        call_args = mock_cur.execute.call_args
        sql_str, params = call_args[0]
        assert isinstance(params, tuple), "SQL parameters must be a tuple (parameterized)"
        assert "Chevrolet" not in sql_str, "make must not be interpolated into the SQL string"
        assert "Equinox" not in sql_str, "model must not be interpolated into the SQL string"
        assert "Equinox" in params
