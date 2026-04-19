// Balloon Finance Warning — spec §9.3
//
// Injects a `warnings` array into a listing object when the contract is a
// balloon finance deal that does NOT have GAP insurance detected.

const GAP_WARNING =
  "GAP insurance not detected in this balloon finance contract. Consider adding before signing.";

/**
 * Returns a copy of the listing with a `warnings` array injected when:
 *   - transaction_type === 'balloon'  AND
 *   - gap_insurance_detected === false
 *
 * Otherwise returns the listing unchanged (no `warnings` key).
 */
export function applyBalloonWarning<
  T extends { transaction_type?: unknown; gap_insurance_detected?: unknown },
>(listing: T): T | (T & { warnings: string[] }) {
  if (
    listing.transaction_type === "balloon" &&
    listing.gap_insurance_detected === false
  ) {
    return { ...listing, warnings: [GAP_WARNING] };
  }
  return listing;
}
