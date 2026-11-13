# Tasks

## 1. Foundation and V0 Gates

- [x] 1.1 Bootstrap a responsive Next.js and TypeScript application, PostgreSQL migrations, and focused unit/integration test commands; verify a clean install, production build, and test run, and document local setup in README.md.
- [x] 1.2 Define server-side provider configuration and explicit V0 readiness gates for product data, image/video rights, text, speech, and rendering; verify automated tests keep real adapters disabled when access, rights/terms, or cost evidence is missing, and label all synthetic fixtures as non-production.

## 2. Product Readiness and Preferences

- [x] 2.1 Implement owner-scoped product facts, source versions, eligibility/freshness, asset provenance, and rights records with migrations; verify unit tests block missing, expired, or out-of-scope data and assets.
- [x] 2.2 Implement the available-product catalog and readiness explanations using synthetic fixtures until a source passes V0; verify unavailable items cannot be selected and document the verified-source configuration contract.
- [x] 2.3 Implement persisted user content preferences and an owner/principal boundary for audience, topic, Traditional Chinese voice, and default style; verify each save creates an immutable version and cross-owner reads or writes are rejected.

## 3. Batch Content Production

- [x] 3.1 Implement batch and content-group state, immutable preference-version snapshots, unique IDs, request deduplication, and durable per-group jobs; verify a 3-product/two-version batch creates at most six groups and duplicate requests do not create duplicate jobs or events.
- [x] 3.2 Define server-only product, text-generation, speech, and rendering adapters with deterministic fake implementations and explicit production enablement checks; verify provider failures, timeouts, and missing configuration are reported without success-shaped outputs.
- [x] 3.3 Implement sourced script generation and per-attempt usage/cost events, with all claims tied to the selected product-fact version; verify unsupported facts are excluded in contract tests and retries retain every attempt and cost.
- [x] 3.4 Implement authorized-asset template editing, Traditional Chinese subtitles/voice, and output validation for playable 15–30 second 1080×1920 MP4; verify format, duration, subtitle-safe-area, audio, and synchronization checks, and keep real rendering disabled until V0 approval.
- [x] 3.5 Implement per-group preview, text/style edits, version history, regeneration, and isolated retry; verify one group's changes or failure do not rerun or overwrite successful groups and preserve user-readable failure reasons.
- [ ] 3.6 Implement server-side pre-export eligibility/rights checks, user confirmation, authorized downloads, and affiliate-disclosure placement; verify unconfirmed or stale groups cannot be exported and no publish operation exists.

## 4. Seven-Day Planning Calendar

- [ ] 4.1 Implement persisted schedule frequency, start date, and user time zone; verify seven-day boundaries across time-zone and daylight-saving transitions.
- [ ] 4.2 Implement editable, saved schedule entries bound to exact confirmed content revisions; verify only valid confirmed content is scheduled, insufficient content is reported without filler, and stale or replaced revisions are marked for user action rather than published or silently replaced.

## 5. Validation and Release Readiness

- [ ] 5.1 Add end-to-end coverage for product readiness through generation, preview, confirmation, export, and calendar editing, including rights changes, provider timeout, duplicate submission, partial failure, and ownership isolation; verify the suite passes with deterministic fixtures.
- [ ] 5.2 Implement validation reporting for qualified-group rate, human-work and wait time, critical errors, rights gaps, unsupported claims, schedule edits, reuse, and per-qualified-group cost; verify failures/abandonments remain in denominators and V2 gates (0 critical errors, at least 12/16 qualified B groups, and conditional 30% median work reduction) are reported without implying publication, orders, or revenue.
- [ ] 5.3 Document V0–V2 release gates, provider enablement, data access, user isolation, retention/deletion, and pilot operations; verify the production checklist prevents a real-user pilot until rights, API terms, costs, access controls, and retention decisions are recorded.
