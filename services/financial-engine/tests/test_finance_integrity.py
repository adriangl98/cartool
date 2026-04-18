"""Unit tests for F04.7 — Finance Integrity Score.

All tests are pure (no database or network calls).
No float literals used anywhere.

Test cases (4 required by spec):
    1. No markup detected          → 100
    2. High markup flagged         → 50
    3. Very High markup flagged    → 20
    4. Indeterminate (no buy rate) → 60
"""

from __future__ import annotations

from app.finance_integrity import finance_integrity_score


class TestFinanceIntegrityScore:
    # ------------------------------------------------------------------
    # Test 1 — No markup detected → 100
    # ------------------------------------------------------------------
    def test_no_markup_returns_100(self) -> None:
        result = finance_integrity_score(mf_markup_flag=False, mf_risk_level="Low")
        assert result == 100

    def test_no_markup_return_type_is_int(self) -> None:
        result = finance_integrity_score(mf_markup_flag=False, mf_risk_level="Moderate")
        assert isinstance(result, int)

    # ------------------------------------------------------------------
    # Test 2 — High markup flagged → 50
    # ------------------------------------------------------------------
    def test_high_markup_returns_50(self) -> None:
        result = finance_integrity_score(mf_markup_flag=True, mf_risk_level="High")
        assert result == 50

    def test_high_risk_level_with_markup_is_50(self) -> None:
        # Verify "High" (not "Moderate" or "Low") specifically maps to 50.
        result = finance_integrity_score(mf_markup_flag=True, mf_risk_level="High")
        assert result == 50

    # ------------------------------------------------------------------
    # Test 3 — Very High markup flagged → 20
    # ------------------------------------------------------------------
    def test_very_high_markup_returns_20(self) -> None:
        result = finance_integrity_score(mf_markup_flag=True, mf_risk_level="Very High")
        assert result == 20

    def test_moderate_markup_returns_20(self) -> None:
        # Any markup flag=True with a risk level other than "High" falls through to 20.
        result = finance_integrity_score(mf_markup_flag=True, mf_risk_level="Moderate")
        assert result == 20

    def test_low_markup_returns_20(self) -> None:
        # Markup detected but risk classified as Low still returns 20 (not 50).
        result = finance_integrity_score(mf_markup_flag=True, mf_risk_level="Low")
        assert result == 20

    # ------------------------------------------------------------------
    # Test 4 — Indeterminate (no buy rate available) → 60
    # ------------------------------------------------------------------
    def test_none_flag_returns_60(self) -> None:
        result = finance_integrity_score(mf_markup_flag=None, mf_risk_level="Low")
        assert result == 60

    def test_none_flag_ignores_risk_level(self) -> None:
        # Risk level is irrelevant when buy rate is unknown.
        assert finance_integrity_score(mf_markup_flag=None, mf_risk_level="Very High") == 60
        assert finance_integrity_score(mf_markup_flag=None, mf_risk_level="High") == 60
        assert finance_integrity_score(mf_markup_flag=None, mf_risk_level="Moderate") == 60

    def test_none_flag_return_type_is_int(self) -> None:
        result = finance_integrity_score(mf_markup_flag=None, mf_risk_level="Low")
        assert isinstance(result, int)
