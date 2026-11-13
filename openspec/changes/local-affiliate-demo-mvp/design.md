# Design

## Context

See `proposal.md` for the motivation and scope. The existing Next.js application already has a synthetic product catalog, a client-side selection flow, a local preference helper, and a deterministic content-preview template. The normal product-selection path also supports verified products and the existing batch API; the demo flow must not weaken its readiness checks.

## Goals / Non-Goals

**Goals:**

- Keep the exhibition workflow available without database, sign-in, or provider configuration.
- Keep demo preferences in browser storage and make simulated content status visible in both the UI and copy.
- Preserve the separate verified-product batch path and existing server-side gates.

**Non-Goals:**

- Persist demo preferences across browsers or devices.
- Treat illustrative product facts as verified or usable for publishing.
- Add external providers, media rendering, scheduling, or analytics.

## Decisions

- Keep demo fixtures and their clearly marked illustrative details in the existing catalog rather than adding a live product source. This avoids implying that prices, commission rates, or item availability are current.
- Use the existing browser-local preference helper and deterministic text template. A real model or service would introduce configuration and nondeterministic claims that are unnecessary for this demonstration.
- Keep saved demo selections and preview history in one validated browser-storage record; malformed or unavailable storage must not block starting a fresh demo. Use client-side filtering over the small fixture catalog.
- Implement copy with the browser clipboard API and text download with a client-created plain-text file, preserving all simulation labels and disclosure text.
- Show product details in an accessible in-page dialog rather than adding a route or backend endpoint; this keeps the short showcase flow in context.
- Keep demo and verified-product selection modes separate. Only verified products may enter the existing server batch API; synthetic demo selections produce local previews and never create production batches.
- Use generic “電商平台” language in user-facing documentation and page copy so the demonstration is not tied to a specific provider.

## Risks / Trade-offs

- [Browser storage can be cleared or unavailable] → Keep defaults available, report save/read errors, and allow the current preview to continue when persistence fails.
- [Illustrative product details could be mistaken for real offers] → Mark the catalog and every price/commission value as示意, label output as simulated, and require independent verification before publication.
- [Selection-flow changes could affect existing production behavior] → Keep its separate readiness and batch path and verify it through existing tests and a production build.
- [Saved browser data may be stale or malformed] → Validate its shape on read, cap history to a small recent set, and provide clear recovery without silently treating it as server data.

## Migration Plan

No database migration or deployment step is required. Rollback consists of reverting the demo-only UI and helper changes; existing production routes and data remain unchanged.
