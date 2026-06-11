# OSAC Integration Plan

> **STATUS: BLOCKED — pending compliance guidance from OSACPrograms@state.gov.**
> Captured 2026-06-11. Pick up cold from this doc.
>
> The OSAC Code of Conduct (https://www.osac.gov/About/CodeOfConduct) has
> non-trivial implications for any integration plan. Three clauses are
> live: Chatham House Rule (Section 4); unauthorized capture/distribution
> of OSAC content (Section 5, violation #1); sharing sensitive operational
> details (Section 5, violation #3). The dashboard would surface
> OSAC-derived content to colleagues who are not themselves OSAC members —
> the structural concern the CoC's redistribution prohibitions are
> written for.
>
> Penalty for misalignment: "temporary or permanent termination of access
> to OSAC membership groups." Getting this wrong loses access entirely.
>
> **Email sent to OSACPrograms@state.gov with five compliance questions
> (see "Compliance gate" section below). DO NOT build any integration
> until written guidance comes back.**

## What we have access to

OSAC application approved — full member access. Confirmed by OSAC analyst team.

**Available OSAC products:**
1. **OSAC Newsletter** — daily email with curated regional news, embassy alerts, demonstration alerts, OSAC announcements
2. **Country Security Reports (CSRs)** — annual per-country deep dives covering crime, terrorism, civil unrest, transportation, corruption, etc. Available for ~every country.
3. **Spot Reports / Intelligence Bulletins** — long-form analyst pieces on specific events (elections, regional trends, conflicts). Bundled into newsletter and on portal.
4. **Direct analyst access** — five regional email distros, 24-48hr response. Can connect to RSOs at embassies.
5. **Common Interest Committees** — peer member groups by region or industry (Aviation, Energy, etc.)
6. **Country Chapters** — local member groups for vendor recommendations and on-ground intel

**Confirmed by OSAC: NO programmatic API.** Portal + email only. Data not designed to be indexed, scraped, or programmatically pulled — partly security posture, partly member-relationship.

**Regional analyst distros:**
- Europe (Turkey + Caucuses): OSACEurope@state.gov
- Middle East / North Africa: OSACMENA@state.gov
- Sub-Saharan Africa: OSACAfrica@state.gov
- Pan-Asia (Central Asia included): OSACAsia@state.gov
- Western Hemisphere: OSACAmericas@state.gov

## Integration architecture (three tiers)

### Tier 1 — Daily newsletter parser (real-time-ish alerts)
**Highest value, cheapest build. Do this first.**

The newsletter is the closest thing OSAC offers to a feed. Embassy security alerts and demonstration alerts are bundled into it daily. This closes the largest detection gap in the existing pipeline (international civil-unrest / protest / embassy-issued security messages).

**Build outline:**
- Subscribe with a dedicated mailbox or Gmail filter (e.g., `osac-feed@…` or labeled inbox)
- New backend adapter `backend/src/adapters/osac_newsletter.ts` — does NOT follow standard SourceAdapter contract because it ingests from email not HTTP
- Email-to-database bridge: Gmail API or IMAP poller picks up the day's newsletter, hands HTML to the parser
- Parser extracts the alerts section; emits structured events (one per alert)
- Each event carries: country, derived severity (heuristic from language — "security alert" → high, "demonstration alert" → mod), category (`public_safety` for embassy alerts, `civil` for demonstration alerts), source URL back to OSAC portal entry
- Cadence: once daily; matches publication
- Defensive parsing: log + alert if the section structure changes (OSAC might tweak the email layout)
- Effort: ~4-6 hours

**Adapter contract design (proposed):**

The standard `SourceAdapter` contract assumes HTTP fetch. OSAC needs an email-source variant. Two options:

A. **Generic `EmailSourceAdapter` interface** with `fetchFromInbox()` instead of HTTP. Future-proof for any email-based source. Bigger initial effort.

B. **One-off** — `osac_newsletter.ts` is special-cased like `who_don.ts` (which has its own `run()` outside the standard pipeline). Less elegant but faster.

Lean toward (B) for first build; refactor to (A) if a second email source ever shows up.

### Tier 2 — Country Security Reports (Risk Profile context)
**Annual refresh, not a live feed. Do after Tier 1 if useful.**

CSRs are exactly what the Country Risk Profile module needs as a structured per-country baseline. They follow a standard structure (Crime / Terrorism / Civil Unrest / Transportation / Law Enforcement / Areas to Avoid / etc.).

**Build outline:**
- Manual download for the 17 countries in `COUNTRY_PRESENCE` on first integration
- Extract structured fields into a new `osac_country_reports` table keyed by ISO code
- Surface in Risk Profile modal alongside ACLED civil-unrest data
- Refresh annually or when OSAC flags an out-of-cycle update (e.g., for an election or major event)
- Effort: 1-2 days for initial 17-country backfill (mostly tedious extraction); cheap to maintain

### Tier 3 — Analyst escalation (incident-time human help)
**Zero code today. Document and forget until needed.**

The five regional distros are a 24-48hr Q&A channel for ad-hoc deep questions during prolonged incidents.

**Build outline:**
- Write the distros into the CMT runbook
- Optional polish: add a "Request OSAC analyst input" button on the Incidents UI that opens a pre-filled `mailto:` with incident context (region, alert title, summary, what we're trying to decide)
- Effort: 30 minutes for the runbook; 2-3 hours if we add the mailto button

## What to skip

- **Common Interest Committees / Country Chapters** — valuable for the human side of CMT (peer benchmarking, vendor recommendations) but they're not data feeds. Worth the operator's time as an OSAC member; don't try to integrate.
- **Spot Reports / Intelligence Bulletins as a separate ingestion** — bundled into the newsletter. The Tier 1 parser picks them up. Don't build a parallel path.
- **OSAC Travel Warnings** — already covered by `state_dept` adapter (OSAC mirrors State Dept TAs). Redundant.

## Open questions to ask OSAC before building Tier 1

**Round 1 — sent and answered 2026-06-11:**

1. ~~Is there a published guide to the daily newsletter's structure?~~ → **No.** OSAC analyst replied: "We do not have guidance available for the format of the newsletter."
2. ~~Is there a preferred OSAC contact for data-handling expectations?~~ → **OSACPrograms@state.gov.** Pointed to the Code of Conduct as the governing document.

**Round 2 — sent to OSACPrograms@state.gov, awaiting response:**

(Sent because the Code of Conduct's clauses about Chatham House Rule, unauthorized capture/distribution, and sharing sensitive operational information have implications the CoC doesn't explicitly resolve. See "Compliance gate" section below.)

1. May full-access members programmatically parse content from OSAC communications into internal corporate systems for real-time safety operations?
2. Does the Code's distribution prohibition apply to internal redistribution to colleagues at the same organization who are not individual OSAC members? If so, should additional CMT members each apply for OSAC membership individually?
3. Attribution requirements when surfacing OSAC-derived information internally — must we cite OSAC, anonymize embassy/consulate origin, or strip both?
4. Does the Chatham House Rule apply to the daily newsletter (one-way push, not a meeting)? Does "free to use the information" permit programmatic ingestion?
5. Embassy alerts often include operational specifics. Is the right boundary to ingest geographic/temporal facts only and strip operational details, or is the entire alert off-limits for internal redistribution?

## Compliance gate (must resolve before any code is written)

The OSAC Code of Conduct has three clauses that materially affect this plan:

**Section 4 — Chatham House Rule**: "participants are free to use the information received, but neither the identity nor the affiliation of the speaker(s)... may be revealed." → Manageable. We could ingest data and act on it internally with source attribution stripped (no "OSAC reports..." or "Embassy of X warns..." in the dashboard).

**Section 5, violation #1 — Unauthorized capture/distribution**: "Unauthorized recording, photography, screenshotting or any other capture of OSAC content... Any distribution of such content constitutes a violation." → Gray zone. Reading the newsletter is authorized. Programmatic extraction into a database that serves it to other colleagues sits in territory the CoC doesn't explicitly address.

**Section 5, violation #3 — Sharing sensitive information**: "Sharing any sensitive information that could compromise security or safety such as specific details about personnel, assets, or operations..." → Real concern. Embassy alerts often include operational details (specific intersections, embassy schedules, transit closures around USG facilities). Surfacing those in the dashboard could land here.

**The structural issue**: only one CMT operator (the OSAC member) is authorized to consume OSAC content. The other 5-11 operators viewing the dashboard are not. The CoC's redistribution prohibitions don't have an exception for "same employer." Getting this wrong = OSAC access termination.

The right path is the email above. Wait for written guidance before building anything.

## What to do when ready to start Tier 1

1. **Wait for first OSAC newsletter to arrive** — that's the structural sample to design the parser against.
2. **Forward the newsletter** to a workspace where it can be opened. Save the raw HTML.
3. **Hand the raw HTML off** for parser design. Things to identify:
   - Section headers for "Embassy Alerts" / "Demonstration Alerts" / similar
   - HTML structure of each alert entry (probably a `<table>` or `<div>` with consistent class names)
   - Link patterns back to OSAC portal entries (so source_url can point to the canonical page, not the email itself)
   - How "Spot Reports" / "Intelligence Bulletins" are structurally distinguished from alerts — we may want to ingest those separately (or filter them out)
4. **Build the parser** with one fixture (the first newsletter) as the test corpus.
5. **Run dry against 3-5 newsletters** before wiring into the live pipeline. Tune the severity heuristic on real data.
6. **Wire to the dashboard** with `source: 'osac_newsletter'` mapped to `Public Safety` category.

## Data-handling commitments (made to OSAC in our reply)

- Internal use only — surfaced only to authenticated CMT operators inside New Relic
- Never redistributed outside the organization
- Stored in the internal Postgres database, accessed via the same SSO-protected dashboard as our other sources
- Respectful poll cadence (newsletter is daily, so polling once daily after expected publication time)
- Defensive parsing — if the format changes and we can't parse, we alert internally rather than guessing

## Technical notes for whoever picks this up

**Why `EmailSourceAdapter` (option A) might be worth the upfront effort:**
If we end up wanting to ingest from any other email source later — vendor security advisories, internal Slack-to-email bridges, Gmail-based alerting — having a generic email-source pattern saved would pay back. But not worth blocking Tier 1 on this. Build the one-off first; refactor when a second email source materializes.

**Existing precedent for non-standard adapter:**
`backend/src/adapters/who_don.ts` already breaks the SourceAdapter mold — it has its own `run()` method that fetches+parses+persists directly to a separate table (`who_outbreaks`) rather than going through the standard `events` pipeline. Use that file as the template for `osac_newsletter.ts` if we go with the one-off approach.

## Recommendation when picking this up

**As of 2026-06-11**: do nothing until OSACPrograms@state.gov replies to the
five compliance questions. The Tier 1 / Tier 2 / Tier 3 architecture above
is provisional and may need rework based on what guidance comes back.

Plausible outcomes from OSACPrograms:

- **Permissive**: "internal ingestion fine, surfacing to non-members within
  the same organization fine, attribution requirements as follows..." —
  proceed with Tier 1 as drafted, modulo any attribution rules.
- **Restrictive but workable**: "additional CMT members must each apply
  individually for OSAC membership before they can view OSAC-derived
  content." — defer integration until enough CMT members are individually
  approved (months timeline). Use OSAC as a reference / human-loop tool
  in the meantime (Tier 3 only).
- **Hard restriction**: "OSAC content is for individual member consumption
  only; internal redistribution in any form requires per-instance approval." —
  Tier 1 dies; we use OSAC as a personal reference for the CMT lead, and
  the dashboard does not directly surface OSAC content.

If OSACPrograms is slow to respond (>2 weeks), follow up once via reply.
If still no response, the de-risk path is to operate as if Outcome 3
applies (most restrictive) and not build the integration.
