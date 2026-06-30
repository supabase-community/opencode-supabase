# TODO - Post-MVP Improvements

This branch provides functional OAuth plumbing and broker integration. The items below are tracked for follow-up work.

## ✅ Keep manual OAuth fallback visible

**Status:** Fixed in current branch

**Change:** The `waiting_callback` state now includes the auth URL and displays it in the dialog so users can complete authorization manually if browser auto-open fails.

## ✅ Replace success copy with shipped capability

**Status:** Fixed in current branch

**Change:** Success toast now says "Connected to Supabase. Management tools coming in next update." instead of promising features that don't exist yet.

## Add first real authenticated tool

**Current state:** OAuth flow completes and persists tokens, but no tools consume them.

**Goal:** Implement one MVP tool (recommend `supabase_list_projects`) to prove:
- Persisted auth works after restart
- Tool-time token reuse is functional
- Management API integration is working

**Files to create/modify:**
- `src/server/tools.ts` (new file)
- `src/server/index.ts` (export tool)
- `src/server/auth.ts` or `src/server/store.ts` (token refresh helper)

## Productize config defaults

**Current state:** Only `OPENCODE_SUPABASE_OAUTH_CLIENT_ID` requires manual configuration. `OPENCODE_SUPABASE_BROKER_URL` now has a default pointing to the official OpenCode broker.

**Issue:** Not turnkey for end users; still scaffold/developer setup.

**Remaining solution options:**
- Add built-in public client ID managed by OpenCode
- Or explicitly document this as internal/dev-only for now

**Files to modify:**
- `src/shared/cfg.ts` (line 46)
- `README.md` (line 147)
- `TESTING.md` (line 76)

## Implement remaining tool surface

**Tools to add:**
- `supabase_login` (fallback tool)
- `supabase_list_organizations`
- `supabase_list_projects`
- `supabase_create_project`

**Reference:** PLAN.md Task 9

**Files to modify:**
- `src/server/tools.ts`
- `src/server/index.ts`

## Implement token lifecycle handling

**Current state:** Tokens are persisted on initial OAuth, but no refresh path exists.

**Requirements:**
- Auto-refresh expired access tokens via broker `POST /refresh`
- Update both plugin-owned store and host auth on successful refresh
- Clear both storage locations and show reconnect message on refresh failure

**Files to modify:**
- `src/server/auth.ts` (add refresh helper)
- `src/server/tools.ts` (use refresh in tool handlers)

## Update TESTING.md when tools ship

**Current state:** TESTING.md explicitly states "This repo does not yet expose a real authenticated tool after login."

**Action:** Remove or update this caveat once the first tool is implemented.

**Files to modify:**
- `TESTING.md` (lines 12, 159)

---

## Merge Policy Options

### Option 1: "Safe to merge now as infrastructure"

Acceptable if:
- PR description clearly states this is OAuth plumbing only, no usable tools yet
- Success copy is adjusted to not over-promise
- Manual fallback UX is acceptable for now

### Option 2: "Safe to merge as MVP" ✅ CURRENT STATE

All requirements satisfied:
- ✅ Manual OAuth fallback is visible during waiting state
- ✅ Success copy honestly describes current capabilities
- ✅ Config is developer-scaffold (acceptable for MVP)

### Option 3: "Needs fixes first"

Not applicable - all blocking issues resolved.

**Status:** Ready to merge as MVP.
