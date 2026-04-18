"""Finance Integrity Score module.

All arithmetic uses decimal.Decimal — no float.

Spec reference: §6.5 (Finance Integrity Score)
Feature: F04.7
"""

from __future__ import annotations

from typing import Optional


def finance_integrity_score(
    mf_markup_flag: Optional[bool],
    mf_risk_level: str,
) -> int:
    """Score the quality of financing based on MF markup flag and risk level.

    Scoring rules (spec §6.5):
        mf_markup_flag is None  → 60  (indeterminate — no buy rate available)
        mf_markup_flag is False → 100 (no markup detected)
        mf_risk_level == "High" → 50  (dealer markup, high risk)
        otherwise               → 20  (Very High markup)

    Args:
        mf_markup_flag: True if dealer markup detected, False if not, None if
                        no buy rate exists for this vehicle (indeterminate).
        mf_risk_level:  Risk label from classify_mf_risk — one of "Low",
                        "Moderate", "High", "Very High".

    Returns:
        Integer score in the range [20, 100].
    """
    if mf_markup_flag is None:
        return 60  # indeterminate
    if not mf_markup_flag:
        return 100
    if mf_risk_level == "High":
        return 50
    return 20  # Very High markup
