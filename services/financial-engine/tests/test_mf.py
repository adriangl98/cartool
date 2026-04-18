"""Unit tests for F04.4 — Money Factor Markup Detection.

All tests are pure (no database or network calls).
get_connection is mocked via unittest.mock.patch for the DB-touching function.
No float literals — every Money Factor value uses decimal.Decimal.

Spec discrepancy note:
  The epic (F04.4) lists the example test case:
      classify_mf_risk(Decimal("0.00250")) → "Very High"
  However spec §6.1 explicitly defines the range 0.00176–0.00250 as "High"
  and reserves "Very High" for > 0.00250.  Implementation and tests here
  follow spec §6.1.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from unittest.mock import MagicMock, patch

from app.mf import (
    MARKUP_THRESHOLD,
    MF_MARKET_AVERAGE_2026,
    apr_to_mf,
    classify_mf_risk,
    detect_mf_markup,
    get_buy_rate,
    mf_to_apr,
)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


class TestConstants:
    def test_markup_threshold_value(self) -> None:
        assert MARKUP_THRESHOLD == Decimal("0.0004")

    def test_markup_threshold_is_decimal(self) -> None:
        assert isinstance(MARKUP_THRESHOLD, Decimal)

    def test_market_average_2026_value(self) -> None:
        assert MF_MARKET_AVERAGE_2026 == Decimal("0.00220")

    def test_market_average_2026_is_decimal(self) -> None:
        assert isinstance(MF_MARKET_AVERAGE_2026, Decimal)


# ---------------------------------------------------------------------------
# mf_to_apr
# ---------------------------------------------------------------------------


class TestMfToApr:
    # ------------------------------------------------------------------
    # Test 1 — Standard 2026 buy rate: 0.00175 → 4.20%
    # ------------------------------------------------------------------
    def test_standard_buy_rate(self) -> None:
        result = mf_to_apr(Decimal("0.00175"))
        assert result == Decimal("4.20")

    # ------------------------------------------------------------------
    # Test 2 — Upper "Low" boundary: 0.00100 → 2.40%
    # ------------------------------------------------------------------
    def test_low_boundary(self) -> None:
        result = mf_to_apr(Decimal("0.00100"))
        assert result == Decimal("2.40")

    # ------------------------------------------------------------------
    # Test 3 — Upper "High" boundary: 0.00250 → 6.00%
    # ------------------------------------------------------------------
    def test_high_boundary(self) -> None:
        result = mf_to_apr(Decimal("0.00250"))
        assert result == Decimal("6.00")

    # ------------------------------------------------------------------
    # Test 4 — Zero MF → 0.00%
    # ------------------------------------------------------------------
    def test_zero_mf(self) -> None:
        result = mf_to_apr(Decimal("0.00000"))
        assert result == Decimal("0.00")

    # ------------------------------------------------------------------
    # Test 5 — 2026 market average: 0.00220 → 5.28%
    # ------------------------------------------------------------------
    def test_market_average_2026(self) -> None:
        result = mf_to_apr(Decimal("0.00220"))
        assert result == Decimal("5.28")

    # ------------------------------------------------------------------
    # Test 6 — Return type is always Decimal
    # ------------------------------------------------------------------
    def test_return_type_is_decimal(self) -> None:
        result = mf_to_apr(Decimal("0.00175"))
        assert isinstance(result, Decimal)


# ---------------------------------------------------------------------------
# apr_to_mf (bidirectional losslessness — spec §6.1 acceptance criteria)
# ---------------------------------------------------------------------------


class TestAprToMf:
    # ------------------------------------------------------------------
    # Test 1 — Round-trip: MF → APR → MF is lossless
    # ------------------------------------------------------------------
    def test_round_trip_via_mf_to_apr(self) -> None:
        original_mf = Decimal("0.001750")
        assert apr_to_mf(mf_to_apr(original_mf)) == original_mf

    # ------------------------------------------------------------------
    # Test 2 — Round-trip: APR → MF → APR is lossless
    # ------------------------------------------------------------------
    def test_round_trip_via_apr_to_mf(self) -> None:
        apr = Decimal("4.20")
        assert mf_to_apr(apr_to_mf(apr)) == apr

    # ------------------------------------------------------------------
    # Test 3 — 4.20% APR → 0.001750 MF
    # ------------------------------------------------------------------
    def test_4_2_percent(self) -> None:
        result = apr_to_mf(Decimal("4.20"))
        assert result == Decimal("0.001750")

    # ------------------------------------------------------------------
    # Test 4 — 5.28% APR → 0.002200 MF (2026 market average)
    # ------------------------------------------------------------------
    def test_market_average(self) -> None:
        result = apr_to_mf(Decimal("5.28"))
        assert result == Decimal("0.002200")

    # ------------------------------------------------------------------
    # Test 5 — 0.00% APR → 0.000000 MF
    # ------------------------------------------------------------------
    def test_zero_apr(self) -> None:
        result = apr_to_mf(Decimal("0.00"))
        assert result == Decimal("0.000000")

    # ------------------------------------------------------------------
    # Test 6 — Return type is always Decimal
    # ------------------------------------------------------------------
    def test_return_type_is_decimal(self) -> None:
        result = apr_to_mf(Decimal("4.20"))
        assert isinstance(result, Decimal)


# ---------------------------------------------------------------------------
# detect_mf_markup
# ---------------------------------------------------------------------------


class TestDetectMfMarkup:
    # ------------------------------------------------------------------
    # Test 1 — Delta 0.00045 > threshold (0.0004) → True
    # Example from epic: detect_mf_markup(0.00220, 0.00175)
    # ------------------------------------------------------------------
    def test_delta_above_threshold_is_markup(self) -> None:
        result = detect_mf_markup(Decimal("0.00220"), Decimal("0.00175"))
        assert result is True

    # ------------------------------------------------------------------
    # Test 2 — Delta 0.00035 ≤ threshold → False
    # Example from epic: detect_mf_markup(0.00210, 0.00175)
    # ------------------------------------------------------------------
    def test_delta_below_threshold_is_not_markup(self) -> None:
        result = detect_mf_markup(Decimal("0.00210"), Decimal("0.00175"))
        assert result is False

    # ------------------------------------------------------------------
    # Test 3 — Delta exactly equal to threshold (0.0004) → False
    # Strictly-greater-than: equal is NOT a markup
    # ------------------------------------------------------------------
    def test_delta_exactly_at_threshold_is_not_markup(self) -> None:
        result = detect_mf_markup(Decimal("0.00215"), Decimal("0.00175"))
        assert result is False

    # ------------------------------------------------------------------
    # Test 4 — Equal MFs (delta = 0) → False
    # ------------------------------------------------------------------
    def test_equal_mfs_is_not_markup(self) -> None:
        result = detect_mf_markup(Decimal("0.00175"), Decimal("0.00175"))
        assert result is False

    # ------------------------------------------------------------------
    # Test 5 — Negative delta (implied < buy_rate) → False
    # ------------------------------------------------------------------
    def test_negative_delta_is_not_markup(self) -> None:
        result = detect_mf_markup(Decimal("0.00150"), Decimal("0.00175"))
        assert result is False

    # ------------------------------------------------------------------
    # Test 6 — Large markup well above threshold → True
    # ------------------------------------------------------------------
    def test_large_markup_is_markup(self) -> None:
        result = detect_mf_markup(Decimal("0.00350"), Decimal("0.00175"))
        assert result is True


# ---------------------------------------------------------------------------
# classify_mf_risk
# ---------------------------------------------------------------------------


class TestClassifyMfRisk:
    # ------------------------------------------------------------------
    # Test 1 — Deep "Low": MF well below 0.00100
    # ------------------------------------------------------------------
    def test_low_deep(self) -> None:
        assert classify_mf_risk(Decimal("0.00050")) == "Low"

    # ------------------------------------------------------------------
    # Test 2 — "Low" upper boundary: exactly 0.00100 → "Low"
    # ------------------------------------------------------------------
    def test_low_upper_boundary(self) -> None:
        assert classify_mf_risk(Decimal("0.00100")) == "Low"

    # ------------------------------------------------------------------
    # Test 3 — "Moderate" lower boundary: 0.00101 → "Moderate"
    # ------------------------------------------------------------------
    def test_moderate_lower_boundary(self) -> None:
        assert classify_mf_risk(Decimal("0.00101")) == "Moderate"

    # ------------------------------------------------------------------
    # Test 4 — "Moderate" upper boundary: exactly 0.00175 → "Moderate"
    # ------------------------------------------------------------------
    def test_moderate_upper_boundary(self) -> None:
        assert classify_mf_risk(Decimal("0.00175")) == "Moderate"

    # ------------------------------------------------------------------
    # Test 5 — "High" lower boundary: 0.00176 → "High"
    # ------------------------------------------------------------------
    def test_high_lower_boundary(self) -> None:
        assert classify_mf_risk(Decimal("0.00176")) == "High"

    # ------------------------------------------------------------------
    # Test 6 — "High" upper boundary: exactly 0.00250 → "High" (spec §6.1)
    # NOTE: the epic F04.4 example states 0.00250 → "Very High", which
    # contradicts spec §6.1 (0.00176–0.00250 = "High"). Spec governs.
    # ------------------------------------------------------------------
    def test_high_upper_boundary(self) -> None:
        assert classify_mf_risk(Decimal("0.00250")) == "High"

    # ------------------------------------------------------------------
    # Test 7 — "Very High" lower boundary: 0.00251 → "Very High"
    # ------------------------------------------------------------------
    def test_very_high_lower_boundary(self) -> None:
        assert classify_mf_risk(Decimal("0.00251")) == "Very High"

    # ------------------------------------------------------------------
    # Test 8 — Deep "Very High": subprime territory
    # ------------------------------------------------------------------
    def test_very_high_deep(self) -> None:
        assert classify_mf_risk(Decimal("0.00350")) == "Very High"


# ---------------------------------------------------------------------------
# get_buy_rate
# ---------------------------------------------------------------------------


def _make_mock_conn(fetchone_return: object) -> tuple[MagicMock, MagicMock]:
    """Return a (mock_conn, mock_cursor) pair for patching get_connection."""
    mock_cursor = MagicMock()
    mock_cursor.fetchone.return_value = fetchone_return
    mock_cursor.__enter__ = lambda s: s
    mock_cursor.__exit__ = MagicMock(return_value=False)

    mock_conn = MagicMock()
    mock_conn.cursor.return_value = mock_cursor
    mock_conn.__enter__ = lambda s: s
    mock_conn.__exit__ = MagicMock(return_value=False)

    return mock_conn, mock_cursor


class TestGetBuyRate:
    # ------------------------------------------------------------------
    # Test 1 — Row found → returns Decimal of base_mf
    # ------------------------------------------------------------------
    def test_found_returns_decimal(self) -> None:
        mock_conn, _ = _make_mock_conn(fetchone_return=("0.001750",))
        with patch("app.mf.get_connection", return_value=mock_conn):
            result = get_buy_rate("Toyota", "Camry", "SE", 2026, date(2026, 4, 1))
        assert result == Decimal("0.001750")
        assert isinstance(result, Decimal)

    # ------------------------------------------------------------------
    # Test 2 — No matching row → returns None
    # ------------------------------------------------------------------
    def test_not_found_returns_none(self) -> None:
        mock_conn, _ = _make_mock_conn(fetchone_return=None)
        with patch("app.mf.get_connection", return_value=mock_conn):
            result = get_buy_rate("Honda", "Accord", "Sport", 2026, date(2026, 4, 1))
        assert result is None

    # ------------------------------------------------------------------
    # Test 3 — trim=None is forwarded as NULL to the parameterized query
    # ------------------------------------------------------------------
    def test_trim_none_passes_null_to_query(self) -> None:
        mock_conn, mock_cursor = _make_mock_conn(fetchone_return=("0.002100",))
        with patch("app.mf.get_connection", return_value=mock_conn):
            result = get_buy_rate("Ford", "Bronco", None, 2026, date(2026, 4, 1))
        assert result == Decimal("0.002100")
        # Confirm None was forwarded as the trim positional parameter
        params = mock_cursor.execute.call_args[0][1]
        assert params[2] is None

    # ------------------------------------------------------------------
    # Test 4 — SQL uses %s placeholders; vehicle values never interpolated
    # ------------------------------------------------------------------
    def test_sql_is_parameterized(self) -> None:
        mock_conn, mock_cursor = _make_mock_conn(fetchone_return=None)
        with patch("app.mf.get_connection", return_value=mock_conn):
            get_buy_rate("Kia", "Telluride", "SX", 2026, date(2026, 4, 1))
        sql: str = mock_cursor.execute.call_args[0][0]
        assert "%s" in sql
        # Vehicle-specific values must NOT appear inside the SQL string
        assert "Kia" not in sql
        assert "Telluride" not in sql
        assert "SX" not in sql

    # ------------------------------------------------------------------
    # Test 5 — psycopg2 may return a float-typed column value; always
    # coerce to Decimal (no float escapes to the caller)
    # ------------------------------------------------------------------
    def test_float_row_value_coerced_to_decimal(self) -> None:
        mock_conn, _ = _make_mock_conn(fetchone_return=(0.00175,))
        with patch("app.mf.get_connection", return_value=mock_conn):
            result = get_buy_rate("BMW", "3 Series", "330i", 2026, date(2026, 4, 1))
        assert isinstance(result, Decimal)
        assert result == Decimal("0.00175")
