# DECISIONS

One section per decision that a reviewer might reasonably have made differently. Every section has
the same four parts, and the third and fourth are the ones we weigh most.

---

### The org-level view counts device-scoped grants (nav lights up if any device allows)

**What I chose:** `resolve` with `deviceId === null` collects ALL grants including
device-scoped ones (`server/permissions.js:collectGrants`); per-device checks filter to
org-wide + that device.
**Why:** `node scripts/check-permissions.js` org-level case: a viewer with a
single-device `device:control` allow must show the nav/action affordance at org level
but only one unlocked row. A device-filtered org view hides the nav item.
**What I rejected:** filtering org-level by org-wide grants only — fails the case above;
the union is the documented semantic (PERMISSIONS.md §3, "the union across all devices").
**What would change my mind:** a spec where nav gating must be satisfiable with zero
device context; it isn't — every device permission is device-scoped (D6).

---

### Deny is checked before anything else, regardless of scope or specificity

**What I chose:** `buildPermissions` (`server/permissions.js`) evaluates all deny-grants
first into a `denied` map; allows can never overwrite it.
**Why:** `check-permissions.js` org-wide-deny vs device-allow case reports
`explicit_deny`. I first assumed narrower scope wins; the observation says scope is
irrelevant (D1).
**What I rejected:** specificity ordering ("narrower wins") and "allow-last-wins" —
both fail the same case for the same reason; carve-outs must be modelled by not
creating the deny.
**What would change my mind:** a case where a narrower allow is expected to survive a
broader deny — I could not construct one from the schema or suites.

---

### Suspended memberships skip the freshness check; removed memberships are 401

**What I chose:** `server/context.js`: `removed` → `unauthenticated` (401);
`suspended` → skip `assertFresh`, resolve to empty set → `403 suspended`.
**Why:** suspension bumps `perm_version`, so asserting freshness converts the required
`403 suspended` into `401 TOKEN_STALE` and destroys the reason the console needs
(AUTH-DATA-MODEL.md §10). Removed means no caller at all → 401, not 403.
**What I rejected:** uniform `assertFresh` for all statuses — loses `suspended`; and
`403` for removed — leaks membership existence.
**What would change my mind:** a client that refreshes on 403; ours refreshes only on
`TOKEN_STALE`, so the distinction is load-bearing.

---

### Cross-org is 404 by construction, via the token claim — not by filtering rows

**What I chose:** `params.org !== claims.org` → `notFound()` before any query; the
token's `org` is the only addressable org (`server/context.js`).
**Why:** `check-api.js` cross-org cases require identical bodies for missing vs
foreign resources (PERMISSIONS.md §6). A filter-then-403 approach confirms existence.
**What I rejected:** querying then deciding 403/404 per row — one forgotten
`WHERE org_id = ?` is a leak; structural scoping removes the class.
**What would change my mind:** multi-org tokens — rejected by D18 (one org per token).

---

### No-laundering is checked at the grant's scope, and unknown patterns fall through to the FK

**What I chose:** `assertMayGrant` resolves the caller's set at the grant's
`deviceId` (org-level for org-wide), expands each pattern; unknown patterns expand to
nothing so the `grant_permissions` FK rejects them as `400` (D19).
**Why:** an admin with an org-wide `deny device:terminal` must fail to grant it
(`403`), while a typo like `device:teleport` must be `400`, not laundering —
`check-api.js` asserts both codes distinctly.
**What I rejected:** validating patterns by string allowlist in code (duplicates the
catalogue; drifts under personalisation) and reporting unknown as `403` (wrong code,
hides typos).
**What would change my mind:** if `PRAGMA foreign_keys` couldn't be relied on —
but `server/db.js` sets it per connection, verified by the FK failure test.

---

### Sessions are grandfathered; only tenancy events cascade

**What I chose:** role/grant changes bump `pv` only (next `POST /sessions` refused);
`endActiveSessions` runs solely on suspend / removal / device transfer, with the
closed `end_reason` vocabulary (`server/lifecycle.js`).
**Why:** `check-api.js` revoke-then-inflight case: running session stays `active`,
next start is `403`. There is deliberately no `permission_revoked` reason in the
schema `CHECK` list — the vocabulary is closed, so new causes must map to existing
values.
**What I rejected:** terminating on revoke (disruptive mid-repair lever; TTL already
bounds exposure via `expires_at`) and adding a new `end_reason` (violates the CHECK).
**What would change my mind:** sessions without TTL — then grandfathering would be
indefinite and revocation would have to cascade.

---

### Exclusivity and invite-uniqueness are index guarantees, not code checks

**What I chose:** rely on `one_exclusive_session_per_device` (partial, `view`
excluded) and `one_live_invite_per_email`; routes translate constraint violations to
`409 DEVICE_BUSY` / `409`.
**Why:** check-then-insert races under concurrency; the schema was verified under
concurrency per `q1-starter/README.md`. Concurrent accepts → exactly one wins with no
application lock.
**What I rejected:** pre-check `SELECT` then `INSERT` — TOCTOU window; application
mutex — doesn't survive multi-process.
**What would change my mind:** a database without partial unique indexes — then the
check-then-act race would have to be closed with serializable transactions.

---

### The console holds no role→permission table; rows carry resolved sets

**What I chose:** `GET /devices` embeds the caller's per-device `permissions` via
batched `resolveDevices` (one grant query + in-memory filter); `web/` renders
`data-permission`/`data-state="unlocked"` or omits the node.
**Why:** the overlay test (undocumented permission) and the intercept test (server
says deny → console must follow) both fail against a hardcoded client matrix. Grep
proof: no `role ===` in `web/`, no `localStorage`/`sessionStorage` tokens.
**What I rejected:** per-row `GET /effective` follow-ups (N+1 requests; the §5.2 row
shape exists to make them unnecessary) and client-side role branching (drifts from
the single engine).
**What would change my mind:** an offline-capable console — then a synced,
versioned policy snapshot would be needed, with explicit staleness handling.

---

## Where this repo argues with itself

1. **Suspended + freshness.** AUTH-DATA-MODEL.md §3 says permission changes bump the
   version and stale tokens get `401 TOKEN_STALE`; §10 says a suspended token yields
   `403` with an empty set. Both hold only if freshness is skipped for suspended
   callers — built as in `server/context.js:45`, because the 403 reason is the
   observable contract and staleness would mask it.

2. **`exp == now`.** Prose "15 minute TTL" suggests expiry after 15 minutes; the auth
   stub contract and `check-jwt.js` require `exp <= now` to count as expired
   (half-open, consistent with D7 grant windows). Built against `<=`.

## Deliberately not built

- Rate limiting, email delivery (invite tokens returned in API response instead),
  password reset — out of scope per `q1-starter/README.md`, no test surface.
- Resolution caching — measured: one indexed membership lookup + catalogue/baseline/
  grants queries per request, single batched query per list; a cache would need
  version-aware invalidation for zero measurable gain at fixture scale.
- Search/pagination beyond audit/members lists — no contract requires it.
