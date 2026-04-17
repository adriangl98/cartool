# E08 — Frontend Web App (React)

**Phase:** Phase 4 (Weeks 12–16)  
**Goal:** A mobile-first, bilingual React web app with Reverse Search as the primary entry point, featuring the Deal Score gauge, One-Tap Disclosure panel, and OBBBA toggle.  
**Spec Reference:** §8 (UX/UI Specification), §12 (Non-Functional Requirements)  
**Depends On:** E05 (all API endpoints), E06 (auth endpoints and JWT session pattern)

---

## Design Principles (Enforced in Every Feature)

1. **Payment-First:** `effective_monthly` is always the large, bold primary number. MSRP is secondary.
2. **Transparency by Default:** Texas tax delta and add-on costs are displayed proactively.
3. **Mobile-First:** All layouts designed for 390px viewport. Desktop is enhanced, not primary.
4. **Bilingual:** Every user-facing string must have both `en` and `es` keys before a feature is marked Done.

---

## Features

### F08.1 — React Project Bootstrap

**Description:** Initialize the React 19 + TypeScript project with routing, i18n, API client, and design tokens.

**Tasks:**
- [ ] Initialize project with Vite + React 19 + TypeScript in `apps/web/`
- [ ] Install: `react-i18next`, `i18next`, `react-router-dom` v6, `axios` (or `fetch` wrapper), `zod`
- [ ] Create `i18n/` directory with `en.json` and `es.json` locale files; add a placeholder string to validate the pipeline works
- [ ] Create `api/` client module:
  - `listingsApi.getListings(filters)` — wraps `GET /listings`
  - `listingsApi.reverseSearch(budget)` — wraps `POST /reverse-search`
  - `listingsApi.getDisclosure(id)` — wraps `GET /listings/:id/disclosure`
  - `listingsApi.getObbba(id)` — wraps `GET /listings/:id/obbba`
  - `authApi.login(email, password)` — stores access token in memory (not `localStorage`)
  - `authApi.refresh()` — calls `POST /auth/refresh` (refresh token is in `HttpOnly` cookie automatically)
- [ ] Define design tokens: primary color, font sizes, spacing scale, Deal Score color bands (green/yellow/red)
- [ ] Set up `react-router-dom` with routes: `/` (reverse search), `/results`, `/listing/:id`

**Acceptance Criteria:**
- `npm run dev` starts the app without errors.
- Switching language between `en` and `es` updates all strings that have been added to both locale files.
- API client sends requests to the correct base URL from environment variable `VITE_API_BASE_URL`.
- Access token is stored in memory (a React context or Zustand store), **never in `localStorage`** (XSS mitigation).

---

### F08.2 — Reverse Search Input Screen

**Description:** The primary landing screen where users enter their budget and deal preferences (spec §8.4 Screen 1).

**Tasks:**
- [ ] Build `ReverseSearchScreen` with the input form from spec §8.4:
  - Monthly budget input (numeric, formatted with `Intl.NumberFormat` in USD)
  - Down payment input (numeric)
  - Term selector: four pill buttons `24 mo | 36 mo | 48 mo | 60 mo`
  - Deal type selector: `Lease | Finance | Balloon`
  - "Find My Cars →" CTA button
- [ ] Validate inputs client-side using Zod before calling the API:
  - Monthly budget > 0
  - Down payment ≥ 0
  - Term and type are selected
- [ ] Show inline field errors in the user's selected language
- [ ] Show a loading skeleton while the API call is in flight
- [ ] On success: navigate to `/results` with the response data

**Acceptance Criteria:**
- Form does not call the API if any validation rule is violated.
- The CTA button is in a loading state (disabled + spinner) during the API call.
- All labels and error messages render correctly in both English and Spanish.
- First Contentful Paint on mobile (390px, throttled 3G simulation) < 2s.

---

### F08.3 — Deal Score Gauge Component

**Description:** Reusable SVG arc gauge displaying the 0–100 Deal Score with color bands (spec §8.2).

**Tasks:**
- [ ] Build `DealScoreGauge` as a standalone React component taking `score: number` as a prop
- [ ] Render as an SVG arc gauge:
  - Green fill for `score 85–100`
  - Yellow fill for `score 70–84`
  - Red fill for `score 0–69`
- [ ] Display the numeric score and the quality label (`"Unicorn Deal"`, `"Excellent Deal"`, etc.) inside the arc
- [ ] **No external chart library** — SVG drawn inline (spec §8.2)
- [ ] On tap/click: expand a three-row breakdown showing:
  - MPMR Score component (50% weight)
  - Market Price component (30% weight)
  - Finance Integrity component (20% weight)
- [ ] Accessibility: `aria-label="Deal Score: [score] — [quality label]"` on the SVG element (spec §8.2)

**Acceptance Criteria:**
- `<DealScoreGauge score={92} />` renders green with label "Excellent Deal".
- `<DealScoreGauge score={55} />` renders red with label "Sub-Optimal Deal".
- Clicking the gauge toggles the breakdown rows open/closed.
- SVG has the correct `aria-label` attribute — passes an `axe` accessibility check.
- Component has no external chart library imports.

---

### F08.4 — Listing Card Component

**Description:** The primary listing presentation unit showing all fields in priority order (spec §8.3).

**Tasks:**
- [ ] Build `ListingCard` component taking a full enriched listing object as a prop
- [ ] Render fields in priority order per spec §8.3:
  1. `DealScoreGauge` (top-right corner)
  2. `effective_monthly` — large, bold, labeled "True Monthly (w/ TX Tax)"
  3. `advertised_monthly` — smaller, dimmed, labeled "Dealer Ad Price"
  4. Year / Make / Model / Trim
  5. Dealer name
  6. Transaction type badge: `LEASE` / `FINANCE` / `BALLOON`
  7. MF Markup Warning badge (only if `mf_markup_flag = true`)
  8. Add-on Alert badge showing count (only if `addons.length > 0`)
  9. OBBBA Eligible badge (only if `obbba_eligible = true` AND `transaction_type = 'finance'`)
- [ ] Tapping the card navigates to `/listing/:id`
- [ ] All badge labels have bilingual strings

**Acceptance Criteria:**
- A listing with `mf_markup_flag = false` and no add-ons shows no warning/alert badges.
- A listing with `mf_markup_flag = true` shows the MF Markup Warning badge prominently.
- The OBBBA badge does not appear on a lease listing, even if `obbba_eligible = true`.
- Snapshot test: the card renders consistently for a known test listing fixture.

---

### F08.5 — Results Screen

**Description:** The listing results list with filter pills, header summary, and scroll-to-load (spec §8.4 Screen 2).

**Tasks:**
- [ ] Build `ResultsScreen`:
  - Header: `"X cars under $[budget]/mo in Laredo"` in bold
  - Sub-header: `"Including Texas tax. Sorted by Deal Score."` (bilingual)
  - Filter pills row: Make · Dealer · OBBBA Only · No Add-ons
  - Render `ListingCard` for each listing in results
  - Implement infinite scroll / "Load More" pagination using the `pagination` object from the API
- [ ] Filter pills update the query parameters and re-fetch results from the API
- [ ] Display empty state if no listings match: `"No cars found within this budget."` (bilingual)

**Acceptance Criteria:**
- Filter pills correctly re-fetch results with the updated filter applied.
- "Load More" appends listings to the existing list (does not clear and re-render).
- Empty state message renders in the correct language.

---

### F08.6 — One-Tap Disclosure Panel

**Description:** A bottom sheet (mobile) or side drawer (desktop) showing fine-print details (spec §8.5).

**Tasks:**
- [ ] Build `DisclosurePanel` triggered by a "View Fine Print" button on the listing detail page
- [ ] On open: call `GET /listings/:id/disclosure`; show loading skeleton
- [ ] Render:
  - Full scraped fine-print text
  - Highlighted add-on line items: each detected add-on shown as a callout with name, estimated cost, and "Mandatory" badge
  - If `tax_credit_flag = true`: display the high-visibility banner: `"Lender Tax Credit Detected — $0 upfront Texas tax. Verify with dealer."` (bilingual)
  - External link: "View Live Dealer Listing" → opens `dealer_listing_url` in a new tab (`rel="noopener noreferrer"`)
- [ ] Implement as a bottom sheet on viewport < 768px and a side drawer on ≥ 768px

**Acceptance Criteria:**
- Panel loads disclosure data on open (not pre-fetched on card render).
- Tax credit banner is visible and distinct when `tax_credit_flag = true`.
- Detected add-ons are listed with their estimated costs.
- The external dealer link opens in a new tab with `noopener noreferrer`.
- Accessible: focus is trapped inside the panel when open; pressing Escape closes it.

---

### F08.7 — OBBBA Toggle Module

**Description:** A filter toggle in the Finance search panel that recalculates displayed payments to show post-deduction "Real Monthly Cost" (spec §8.6).

**Tasks:**
- [ ] Add a toggle switch to the Finance search filter bar: "Apply OBBBA Interest Deduction"
- [ ] When toggle is enabled: display a tax bracket selector `22% | 24% | 32% | 35%`
- [ ] On bracket selection: call `GET /listings/:id/obbba` for each visible finance listing and subtract the `monthly_savings` from the displayed EMP
- [ ] Display the adjusted payment as `"Real Monthly (w/ OBBBA): $XXX"` below the EMP on each card
- [ ] The toggle and bracket selection persist in the URL query string (so the result is shareable)

**Acceptance Criteria:**
- The toggle is only visible when `transaction_type = 'finance'` is the active filter.
- Selecting 24% bracket displays the correct reduced monthly payment on OBBBA-eligible listings.
- Non-OBBBA-eligible listings are not affected by the toggle (no "Real Monthly" row shown).
- The URL reflects the current toggle state: `?obbba=true&bracket=24`.

---

### F08.8 — Auth UI (Login, Register, Saved Searches)

**Description:** Minimal auth screens and saved search management for logged-in users.

**Tasks:**
- [ ] Build `LoginScreen` and `RegisterScreen` with form validation (bilingual)
- [ ] Store access token in React context; implement silent refresh via `POST /auth/refresh` before token expiry
- [ ] Build `SavedSearchesScreen`:
  - List the user's saved searches
  - Toggle `alert_enabled` on/off per search
  - Delete a saved search
  - Button to "Run Search" (pre-populates the Reverse Search form)

**Acceptance Criteria:**
- After login, the access token is in memory — not visible in `localStorage` or `sessionStorage` when inspected in browser DevTools.
- Silent refresh fires when the access token has less than 2 minutes remaining.
- A user cannot navigate to `SavedSearchesScreen` without a valid session (redirect to login).

---

### F08.9 — Accessibility & Performance Audit

**Description:** Ensure the app meets WCAG 2.1 AA and Lighthouse mobile score ≥ 85 before beta launch.

**Tasks:**
- [ ] Run `axe-core` audit on: `ReverseSearchScreen`, `ResultsScreen`, `ListingCard`, `DealScoreGauge`, `DisclosurePanel`
- [ ] Fix any critical or serious `axe` violations before marking Done
- [ ] Run Lighthouse on `ResultsScreen` on simulated mobile (Moto G4, 3G): ensure Performance ≥ 85
- [ ] Add `lang="en"` / `lang="es"` to `<html>` based on active locale
- [ ] Ensure all interactive elements are keyboard-navigable (Tab through card list, Enter to open disclosure)
- [ ] Ensure `DealScoreGauge` aria attributes are correct (F08.3)

**Acceptance Criteria:**
- Zero `axe` violations of severity "critical" or "serious" on the listed screens.
- Lighthouse Performance score ≥ 85 on mobile simulation.
- All form fields have associated `<label>` elements.

---

### F08.10 — E2E Tests (Playwright)

**Description:** End-to-end tests covering the three critical user flows.

**Tasks:**
- [ ] Write E2E test: **Reverse Search flow**
  - Enter budget $550/mo, $2,500 down, 36 months, Finance
  - Assert results page loads with cards showing EMP ≤ $550
  - Assert header shows correct count and sub-header text
- [ ] Write E2E test: **Disclosure panel flow**
  - Click a listing card → navigate to detail
  - Open disclosure panel
  - Assert add-on items appear (if any on the fixture listing)
- [ ] Write E2E test: **OBBBA toggle flow**
  - Enable OBBBA toggle, select 24% bracket
  - Assert "Real Monthly" appears on at least one OBBBA-eligible listing
  - Assert non-eligible listings show no "Real Monthly" row
- [ ] All E2E tests run against a local test API with seeded fixture data

**Acceptance Criteria (Phase 4 DoD):** Beta testers can complete a Reverse Search from budget input to disclosure panel review in under 60 seconds on a mobile device.

---

## Dependencies for Downstream Epics

| Downstream Epic | Requires from E08 |
|---|---|
| E09 (Mobile App) | Shared component patterns, API client module, i18n strings |
