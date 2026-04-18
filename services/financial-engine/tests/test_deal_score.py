"""Unit tests for F04.8 — Deal Score Composite Algorithm.

All tests are pure (no database or network calls).
No float literals — every numeric value uses int or decimal.Decimal.

Test cases:
    1. Unicorn Deal — all-max component scores → 100
    2. Sub-Optimal Deal — all-min component scores → low score
    3. Balloon finance bonus adds 5 points
    4. Balloon bonus is clamped at 100 (no overflow)
    5. Mid-range deal — manual spreadsheet verification
    6. Clamp floor — no negative scores
    7. Return type is always int
    8. Non-balloon transaction_type omits the bonus
    9. score_listing orchestrator — unicorn deal end-to-end (DB mocked)
   10. score_listing orchestrator — balloon listing applies bonus (DB mocked)
   11. score_listing orchestrator — deal_score in [0, 100]
   12. Weighted formula precision: fractional raw scores round correctly
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional
from unittest.mock import patch

import pytest

from app.deal_score import (
    NormalizedListing,
    ScoredListing,
    _BALLOON_BONUS,
    _FINANCE_WEIGHT,
    _MARKET_WEIGHT,
    _MPMR_WEIGHT,
    calculate_deal_score,
    score_listing,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_listing(
    *,
    monthly_payment: str = "349.00",
    term_months: int = 36,
    due_at_signing: str = "2500.00",
    msrp: str = "45000.00",
    adjusted_selling_price: str = "43000.00",
    addon_adjusted_price: str = "43000.00",
    acquisition_fee: Optional[str] = None,
    doc_fee: Optional[str] = None,
    tax_credit_flag: bool = False,
    transaction_type: str = "lease",
    implied_mf: Optional[str] = None,
) -> NormalizedListing:
    return NormalizedListing(
        listing_id=1,
        make="Toyota",
        model="RAV4",
        trim="XLE",
        year=2026,
        msrp=Decimal(msrp),
        monthly_payment=Decimal(monthly_payment),
        term_months=term_months,
        due_at_signing=Decimal(due_at_signing),
        acquisition_fee=Decimal(acquisition_fee) if acquisition_fee else None,
        doc_fee=Decimal(doc_fee) if doc_fee else None,
        adjusted_selling_price=Decimal(adjusted_selling_price),
        addon_adjusted_price=Decimal(addon_adjusted_price),
        tax_credit_flag=tax_credit_flag,
        transaction_type=transaction_type,
        implied_mf=Decimal(implied_mf) if implied_mf else None,
    )


# ---------------------------------------------------------------------------
# Weight constants
# ---------------------------------------------------------------------------


class TestWeightConstants:
    def test_mpmr_weight_value(self) -> None:
        assert _MPMR_WEIGHT == Decimal("0.50")

    def test_market_weight_value(self) -> None:
        assert _MARKET_WEIGHT == Decimal("0.30")

    def test_finance_weight_value(self) -> None:
        assert _FINANCE_WEIGHT == Decimal("0.20")

    def test_weights_sum_to_one(self) -> None:
        assert _MPMR_WEIGHT + _MARKET_WEIGHT + _FINANCE_WEIGHT == Decimal("1.00")

    def test_balloon_bonus_value(self) -> None:
        assert _BALLOON_BONUS == 5

    def test_all_weights_are_decimal(self) -> None:
        for w in (_MPMR_WEIGHT, _MARKET_WEIGHT, _FINANCE_WEIGHT):
            assert isinstance(w, Decimal)


# ---------------------------------------------------------------------------
# calculate_deal_score
# ---------------------------------------------------------------------------


class TestCalculateDealScore:
    # ------------------------------------------------------------------
    # Test 1 — Unicorn Deal: all max scores → 100
    # ------------------------------------------------------------------
    def test_all_max_scores_returns_100(self) -> None:
        result = calculate_deal_score(mpmr_s=100, market_s=100, finance_s=100)
        assert result == 100

    def test_unicorn_return_type_is_int(self) -> None:
        result = calculate_deal_score(mpmr_s=100, market_s=100, finance_s=100)
        assert isinstance(result, int)

    # ------------------------------------------------------------------
    # Test 2 — Sub-Optimal Deal: all-low component scores → low score
    #   manual: (25×0.50) + (20×0.30) + (20×0.20) = 12.5 + 6 + 4 = 22.5 → 23
    # ------------------------------------------------------------------
    def test_sub_optimal_deal_low_score(self) -> None:
        # ROUND_HALF_UP: 22.5 → 23
        result = calculate_deal_score(mpmr_s=25, market_s=20, finance_s=20)
        assert result == 23

    def test_sub_optimal_deal_is_below_50(self) -> None:
        result = calculate_deal_score(mpmr_s=25, market_s=20, finance_s=20)
        assert result < 50

    # ------------------------------------------------------------------
    # Test 3 — Balloon finance bonus adds 5 points
    #   base: (70×0.50) + (80×0.30) + (100×0.20) = 35 + 24 + 20 = 79
    #   with balloon bonus: 79 + 5 = 84
    # ------------------------------------------------------------------
    def test_balloon_bonus_adds_five_points(self) -> None:
        base = calculate_deal_score(mpmr_s=70, market_s=80, finance_s=100, transaction_type="lease")
        balloon = calculate_deal_score(mpmr_s=70, market_s=80, finance_s=100, transaction_type="balloon")
        assert balloon == base + 5

    def test_balloon_bonus_exact_value(self) -> None:
        # base = 79, balloon = 84
        result = calculate_deal_score(mpmr_s=70, market_s=80, finance_s=100, transaction_type="balloon")
        assert result == 84

    def test_non_balloon_does_not_get_bonus(self) -> None:
        lease_score = calculate_deal_score(mpmr_s=70, market_s=80, finance_s=100, transaction_type="lease")
        finance_score = calculate_deal_score(mpmr_s=70, market_s=80, finance_s=100, transaction_type="finance")
        assert lease_score == finance_score == 79

    # ------------------------------------------------------------------
    # Test 4 — Balloon bonus is clamped at 100 (no overflow)
    #   base: (100×0.50) + (100×0.30) + (100×0.20) = 100
    #   with bonus: 100 + 5 = 105 → clamped to 100
    # ------------------------------------------------------------------
    def test_balloon_bonus_clamped_at_100(self) -> None:
        result = calculate_deal_score(mpmr_s=100, market_s=100, finance_s=100, transaction_type="balloon")
        assert result == 100

    def test_high_base_with_balloon_clamped(self) -> None:
        # base: (100×0.50) + (80×0.30) + (100×0.20) = 50+24+20 = 94 → +5 = 99 ≤ 100
        result = calculate_deal_score(mpmr_s=100, market_s=80, finance_s=100, transaction_type="balloon")
        assert result == 99

    # ------------------------------------------------------------------
    # Test 5 — Mid-range deal — manual spreadsheet verification
    #   mpmr_s=85, market_s=60, finance_s=100
    #   → (85×0.50) + (60×0.30) + (100×0.20) = 42.5 + 18 + 20 = 80.5 → 81
    # ------------------------------------------------------------------
    def test_mid_range_deal_manual_verification(self) -> None:
        result = calculate_deal_score(mpmr_s=85, market_s=60, finance_s=100)
        assert result == 81

    # ------------------------------------------------------------------
    # Test 6 — Clamp floor: cannot produce negative score
    # ------------------------------------------------------------------
    def test_clamp_floor_zero(self) -> None:
        # 0×0.50 + 0×0.30 + 0×0.20 = 0; no scenario produces negative naturally
        result = calculate_deal_score(mpmr_s=0, market_s=0, finance_s=0)
        assert result == 0

    def test_score_never_exceeds_100(self) -> None:
        result = calculate_deal_score(mpmr_s=100, market_s=100, finance_s=100, transaction_type="balloon")
        assert result <= 100

    def test_score_never_below_0(self) -> None:
        result = calculate_deal_score(mpmr_s=0, market_s=0, finance_s=0)
        assert result >= 0

    # ------------------------------------------------------------------
    # Precision: fractional raw rounds up on 0.5 (ROUND_HALF_UP)
    #   25×0.50 + 20×0.30 + 20×0.20 = 12.5 + 6 + 4 = 22.5 → 23
    # ------------------------------------------------------------------
    def test_half_point_rounds_up(self) -> None:
        result = calculate_deal_score(mpmr_s=25, market_s=20, finance_s=20)
        assert result == 23

    def test_another_half_point_rounds_up(self) -> None:
        # 85×0.50 + 80×0.30 + 100×0.20 = 42.5 + 24 + 20 = 86.5 → 87
        result = calculate_deal_score(mpmr_s=85, market_s=80, finance_s=100)
        assert result == 87


# ---------------------------------------------------------------------------
# score_listing orchestrator
# ---------------------------------------------------------------------------


class TestScoreListing:
    """Tests for score_listing — DB calls are mocked out."""

    # ------------------------------------------------------------------
    # Test 9 — Unicorn Deal end-to-end (no DB interaction, regional_avg=None → 60)
    #
    #   Listing: $200/mo, 36mo, $0 DAS, MSRP $45,000, no fees (defaults applied)
    #   No tax credit, adjusted_selling_price = $30,000
    #
    #   texas_tax = 30000 × 0.0625 = $1,875.00
    #   tcol = (200×36) + 0 + 895 + 150 + 1875 = 7200 + 2920 = 10120 → $10,120.00
    #   emp  = 10120 / 36 = 281.11 (rounded)
    #   mpmr = 281.11 / 45000 = 0.006247 (6 dp)
    #   mpmr_score = 100 (≤ 0.0085 → Unicorn)
    #   market_score = 60 (None regional avg → neutral)
    #   finance_score = 60 (no implied_mf → mf_markup_flag=None → indeterminate)
    #   deal_score = round(100×0.50 + 60×0.30 + 60×0.20) = round(50+18+12) = 80
    # ------------------------------------------------------------------
    def test_unicorn_deal_end_to_end(self) -> None:
        listing = _make_listing(
            monthly_payment="200.00",
            term_months=36,
            due_at_signing="0.00",
            msrp="45000.00",
            adjusted_selling_price="30000.00",
            addon_adjusted_price="30000.00",
        )
        with patch("app.deal_score.get_regional_avg", return_value=None):
            result = score_listing(listing)

        assert isinstance(result, ScoredListing)
        assert result.deal_score == 80
        assert result.mpmr_score_value == 100
        assert result.mpmr_category == "Unicorn Deal"
        assert result.market_score == 60
        assert result.finance_score == 60

    # ------------------------------------------------------------------
    # Test 10 — Balloon listing applies bonus
    #
    #   Same setup as unicorn (deal_score base = 80) but transaction_type='balloon'
    #   Expected deal_score = 80 + 5 = 85
    # ------------------------------------------------------------------
    def test_balloon_listing_gets_bonus(self) -> None:
        listing = _make_listing(
            monthly_payment="200.00",
            term_months=36,
            due_at_signing="0.00",
            msrp="45000.00",
            adjusted_selling_price="30000.00",
            addon_adjusted_price="30000.00",
            transaction_type="balloon",
        )
        with patch("app.deal_score.get_regional_avg", return_value=None):
            result = score_listing(listing)

        assert result.deal_score == 85
        assert result.transaction_type == "balloon"

    # ------------------------------------------------------------------
    # Test 11 — deal_score is always within [0, 100]
    # ------------------------------------------------------------------
    def test_deal_score_within_valid_range(self) -> None:
        listing = _make_listing(
            monthly_payment="800.00",
            term_months=36,
            due_at_signing="5000.00",
            msrp="25000.00",
            adjusted_selling_price="30000.00",
            addon_adjusted_price="30000.00",
        )
        with patch("app.deal_score.get_regional_avg", return_value=None):
            result = score_listing(listing)

        assert 0 <= result.deal_score <= 100

    # ------------------------------------------------------------------
    # Test 12 — Return type is ScoredListing with all expected fields
    # ------------------------------------------------------------------
    def test_scored_listing_has_all_fields(self) -> None:
        listing = _make_listing()
        with patch("app.deal_score.get_regional_avg", return_value=None):
            result = score_listing(listing)

        required_fields = [
            "listing_id", "emp", "tcol", "mpmr", "mpmr_score_value",
            "mpmr_category", "market_score", "mf_markup_flag",
            "mf_risk_level", "finance_score", "deal_score", "texas_tax",
        ]
        for field in required_fields:
            assert hasattr(result, field), f"Missing field: {field}"

    # ------------------------------------------------------------------
    # Test 13 — Market price score uses regional_avg when available
    #   addon_adjusted_price = $43,000, regional_avg = $45,000
    #   ratio = 43000/45000 = 0.9556 → ≤ 0.95? No → ≤ 1.00 → 80
    # ------------------------------------------------------------------
    def test_market_score_uses_regional_avg(self) -> None:
        listing = _make_listing(
            monthly_payment="200.00",
            msrp="45000.00",
            addon_adjusted_price="43000.00",
            adjusted_selling_price="43000.00",
        )
        with patch("app.deal_score.get_regional_avg", return_value=Decimal("45000.00")):
            result = score_listing(listing)

        assert result.market_score == 80

    # ------------------------------------------------------------------
    # Test 14 — Tax credit suppresses texas_tax
    # ------------------------------------------------------------------
    def test_tax_credit_flag_zero_tax(self) -> None:
        listing = _make_listing(
            adjusted_selling_price="40000.00",
            tax_credit_flag=True,
        )
        with patch("app.deal_score.get_regional_avg", return_value=None):
            result = score_listing(listing)

        assert result.texas_tax == Decimal("0.00")
