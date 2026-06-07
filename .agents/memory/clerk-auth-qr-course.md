---
name: Clerk auth on qr-course
description: How/why authentication is wired into the Teach Yourself Mathematical Notation app
---

# Clerk auth on the math-notation course app

Replit-managed Clerk is set up on `artifacts/qr-course` (web) + `artifacts/api-server` (Express proxy).

**Decision — all app routes stay public; auth is additive, not gating.**
The course content *is* the product and there is no separate marketing/landing
page, so the base path `/` keeps rendering the Dashboard for signed-out users.
Sign in / Log out lives in the TopBar (`components/layout/Layout.tsx`,
`AuthControls`). We intentionally did NOT add a HomeRedirect/portal split or
wrap routes in signed-in-only gates.
**Why:** user asked only to "create Google login"; locking everyone out of a
single-product course app would be a destructive over-reach and also conflicts
with the clerk skill's rule that the base path must be publicly accessible.
**How to apply:** if asked to protect specific features later, gate those
routes/endpoints individually (`requireAuth` on the API, `<Show>` on the
client) rather than gating the whole app.

Login providers (Google, etc.) are managed in the workspace **Auth pane**, not
in code. Google is enabled by default on the provisioned tenant.
