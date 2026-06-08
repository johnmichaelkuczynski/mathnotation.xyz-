---
name: API route conventions (qr-course / api-server)
description: When to put an endpoint in OpenAPI vs. a plain Express route, and how the frontend calls each.
---

# Endpoint placement convention

Not every endpoint lives in the OpenAPI contract. The codebase has two coexisting patterns:

- **Contract-first (OpenAPI + generated React Query hooks + Zod):** the default for stable, typed data endpoints (course overview, assignments list, attempts, etc.).
- **Plain Express route called via raw `fetch('/api/...', {credentials:'include'})`:** used for AI/interactive/streaming endpoints (tutor suggestions, tutor feedback dialogue, diagnostics, on-the-spot lecture expansion, practice-assignment twin generation + submit, focus analytics).

**Why:** the AI endpoints return free-form/LLM-shaped payloads and stream, so forcing them through the codegen pipeline adds friction with little benefit. Raw fetch against absolute `/api/...` works because the shared proxy routes `/api` globally.

**How to apply:** when adding an AI/interactive endpoint, mirror the raw-fetch pattern rather than editing the OpenAPI spec. Reserve OpenAPI for stable typed CRUD-ish data.

# Practice submit guards

`POST /practice/assignment/:sessionId/submit` must enforce `session.mode === 'assignment'` (400 otherwise) and reject when `session.submittedAt` is already set (409) — practice twins are infinite via *new* sessions, never resubmission of an existing one.

# Infinite practice-twin no-repeat guarantee

`POST /assignments/:id/practice` must never reproduce (a) any real graded problem of that assignment or (b) any problem from a prior practice run of that assignment — across unlimited regenerations.

**Why:** the user demanded infinite practice with zero repeats and zero leakage of the actual test.

**How to apply:** build a `forbidden` Set of normalized prompts from ALL real problems + ALL prior practice problems for the assignment (not a recent window), enforce it server-side after each LLM generation with retry; generate sequentially so problems in the same run also dedup against each other (`usedNorm`). Send only a bounded, deterministically-ordered (`orderBy(desc(id))`) recent slice to the LLM as a token-bounded hint — the full Set is what enforces the guarantee. Never fall back to copying the real problem on LLM failure; use a topic-scoped distinct variant.

# skill_events.flagged

`skill_events.flagged` on the graded path must be derived from detection results (`aiFlagged || diachronicFlagged`), so insert the skill_event *after* running `detect()`, not before. Focus analytics reads this column; if you log the event before detection it is always false and the "surgical analytics" risk signal is dead.
