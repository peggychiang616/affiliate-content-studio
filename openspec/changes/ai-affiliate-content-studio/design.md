# Design

## Context

See proposal.md for the motivation and scope. This is a greenfield responsive web application: the repository currently contains only OpenSpec files, so there is no framework, data model, deployment target, or integration to preserve. Product data access, asset rights, third-party APIs, and service costs are unverified and must pass the proposal's V0 checks before a real provider is enabled.

The behavior contract is in the three capability specs. In particular, product facts and media rights gate production and export; generation is per content group; and the calendar is advisory, not a publishing integration.

## Goals / Non-Goals

**Goals:**
- Establish a maintainable full-stack web foundation for the specified MVP without coupling product behavior to a single AI or media vendor.
- Keep each product, asset, content revision, job, cost event, confirmation, export, and calendar entry traceable to its source and owner.
- Make development and acceptance testing possible with deterministic fixtures while preventing fixtures from being mistaken for Shopee data or licensed production assets.
- Support isolated, retryable media work and independently recoverable groups in a batch.

**Non-Goals:**
- Choose or implement a Shopee scraping/API integration, a commercial AI provider, or a media service before V0 establishes access, rights, terms, and cost.
- Automatically publish content, generate replacement product imagery, or calculate affiliate earnings.
- Optimize for broad catalog scale or multi-platform publishing in this MVP.

## Decisions

### Use a TypeScript full-stack web application

Bootstrap a responsive Next.js application using TypeScript, with server-side route handlers for authenticated data operations and background-work submission. Keep domain rules in modules that can be tested independently of UI routes.

This fits the confirmed web target and supports a single deployable application for the first MVP. A separate frontend and backend would add deployment and API coordination before scale or team boundaries are known. A static-only application is insufficient for protected media, durable jobs, ownership checks, and server-side provider credentials.

### Use relational records for product and workflow state

Use PostgreSQL for owned records and workflow transitions. Model users, preferences, products, sourced facts, assets and rights, batches, content groups and revisions, jobs, usage/cost events, review/export events, and schedule entries with explicit foreign keys and timestamps. Keep generated media in private object storage and store only object references and checksums in the database.

Relational transactions and uniqueness constraints make batch/group IDs, request deduplication, ownership, and event recording explicit. Store generated revisions rather than overwriting them so a schedule or export can refer to the exact reviewed version. Do not retain source media or generated artifacts beyond a retention policy confirmed before participant testing.

### Isolate provider integrations behind explicit adapters

Define separate interfaces for product-data access, text generation, speech, and video rendering. Provider-specific credentials remain server-side. The first implementation and automated tests use deterministic fake adapters and clearly labeled, synthetic fixtures. A production adapter may be enabled only after V0 verifies the provider's API, terms, licensing, price, and output constraints.

This avoids selecting vendors based on marketing claims or silently substituting unsupported sources. It also lets the workflow and error behavior be tested without exposing real credentials. Fake adapters must never produce a record marked as real Shopee data or as rights-cleared production media.

### Process work asynchronously per content group

Represent a batch as up to six independently tracked groups. Persist each requested transition before queueing work; use a stable request key for batch creation and a group/revision key for generation. Workers re-check product and rights status before generation and export, record provider usage and costs for every attempt, and retry only the failed group. A retry must not duplicate a successful output or confirmation event.

Long-running script, speech, and rendering work does not belong in a synchronous browser request. A durable job boundary provides progress reporting and local recovery. Provider timeouts and rejected jobs become explicit failure states with user-readable reasons; they do not produce success-shaped placeholder downloads.

### Treat eligibility, confirmation, and export as server-side gates

Centralize checks for product freshness, eligibility, asset rights, output validation, and confirmation in domain services invoked by both UI and server endpoints. The client cannot mark an unverified product ready, confirm another user's content, or export an unconfirmed/stale revision. Media downloads use short-lived authorized links, and application logs avoid storing platform credentials or unnecessary personal data.

This prevents UI-only checks from being bypassed and keeps calendar references tied to exact confirmed revisions. Before any real user pilot, define authentication, user isolation, data retention/deletion, and access controls; the application must not request Shopee account passwords.

### Keep scheduling advisory and version-bound

Store schedule dates as calendar dates in the user's configured time zone and reference a specific confirmed content revision. Validate that entries fall inside the configured seven-day window. When a referenced revision becomes invalid or is replaced, mark the entry for user action rather than changing it or publishing it automatically.

Using explicit time-zone preferences avoids ambiguous browser/server date conversions. A general-purpose publishing or social-media scheduler is unnecessary and out of scope.

### Instrument outcomes without conflating them

Record batch/group IDs, initial and retry attempts, human edit/review time, processing wait time, validation results, confirmation/export, user assistance, schedule edits, and attributable provider costs. Report failed and abandoned groups in denominators. Keep generated-file counts distinct from qualified content groups, and do not infer publication, clicks, orders, or revenue from generation or export.

The validation report should preserve the brief's decision rules: 0 critical errors, at least 12/16 qualified B groups for the V2 batch threshold, and the 30% median human-work reduction only when the stated completion/comparability conditions are met. These are exploratory gates, not guarantees of statistical significance.

## Risks / Trade-offs

- [No verified data or rights source may be available] → Treat V0 as a release gate; do not enable real production or call unsupported materials licensed.
- [Provider quality or cost may make the requested MP4 impractical] → Measure costs and failures per group and retry; stop expansion if critical quality or cost gates fail.
- [A fake integration can look more complete than it is] → Clearly label fixture data and disable participant-facing claims until a verified adapter is configured.
- [AI may still invent facts or produce misleading visuals] → Preserve source versions, validate and review each group, and block on critical errors; automated checks are not a substitute for review.
- [Private media and product data can be exposed] → Enforce owner checks server-side, keep object storage private, issue short-lived download links, and define retention/deletion before the pilot.
- [Video processing can outlive a web request or be retried twice] → Use durable per-group jobs, unique request keys, explicit job states, and idempotent event writes.

## Migration Plan

There is no existing application or user data to migrate. Create the initial schema with forward-only migrations and seed only synthetic development fixtures. Roll back by disabling provider adapters and reverting the web deployment; preserve the database and media until a tested retention/deletion procedure is in place. Do not run a participant pilot until V0 gates and access controls pass.

## Open Questions

- Which product-data and media-rights sources pass V0, and what permitted usage and freshness limits do they provide?
- Which text, speech, and rendering providers meet the required output quality, API terms, latency, and per-qualified-group cost?
- Which authentication and private object-storage services are available in the eventual deployment environment?
- What retention period, deletion workflow, and disclosure wording are approved before user testing?
