# Laredo Automotive Market Intelligence — Project Management

**Last Updated:** April 16, 2026  
**Spec Reference:** `docs/technical-spec.md`

---

## Development Philosophy

This project is broken into **9 Epics**, each scoped to a single deployable service or layer. Each epic contains discrete **Features** that a coding agent can implement and test in isolation. Dependencies between epics are explicit so work can be sequenced correctly.

**Rule for coding agents:** Every feature has an _Acceptance Criteria_ section. Do not mark a feature complete until every criterion is verifiably met.

---

## Epic Map

| # | Epic | Phase | Status | Depends On |
|---|---|---|---|---|
| [E01](epic-01-infrastructure.md) | Infrastructure & DevOps | Pre-work | Not Started | — |
| [E02](epic-02-scraper-foundation.md) | Scraper Foundation | Phase 1 | Not Started | E01 |
| [E03](epic-03-data-enrichment.md) | Data Enrichment & Normalization | Phase 1 | Not Started | E02 |
| [E04](epic-04-financial-engine.md) | Financial Intelligence Engine | Phase 2 | Not Started | E03 |
| [E05](epic-05-core-api.md) | Core API Service | Phase 3 | Not Started | E04 |
| [E06](epic-06-auth-service.md) | Auth & User Management | Phase 3 | Not Started | E01 |
| [E07](epic-07-notifications.md) | Notification Service | Phase 3 | Not Started | E06 |
| [E08](epic-08-frontend-web.md) | Frontend Web App (React) | Phase 4 | Not Started | E05, E06 |
| [E09](epic-09-mobile-app.md) | Mobile App (React Native) | Phase 4 | Not Started | E08 |

---

## Dependency Graph

```
E01 (Infrastructure)
 ├── E02 (Scraper Foundation)
 │    └── E03 (Data Enrichment)
 │         └── E04 (Financial Engine)
 │              └── E05 (Core API)
 │                   └── E08 (Frontend Web)
 │                        └── E09 (Mobile App)
 └── E06 (Auth Service)
      ├── E07 (Notification Service)
      └── E08 (Frontend Web)
```

---

## Definition of Done (Project-Wide)

A feature is **Done** when:
1. Code is implemented and passes all unit tests.
2. Acceptance criteria in the feature file are met.
3. No `npm audit` / `pip audit` critical vulnerabilities.
4. The feature is reviewed against the relevant section of `docs/technical-spec.md`.
5. Code is merged to `main` via a passing CI pipeline.

---

## Key Cross-Cutting Concerns

These apply to _all_ epics:

- **Security:** All DB queries use parameterized statements. No raw string concatenation. See spec §11.
- **Precision:** All monetary math uses `decimal.Decimal` (Python) or a decimal library (JS). Never native floats.
- **Localization:** All user-facing strings must have `en` and `es` keys in the i18n files.
- **Logging:** Auth events, scrape errors, and flagged listings must emit structured logs.
- **Secrets:** No credentials in source code. All secrets via environment variables or AWS Secrets Manager.
