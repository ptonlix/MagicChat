# OIDC Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable OIDC login for normal users, with admin-managed providers and a shared `/init` post-login entry page.

**Architecture:** Store OIDC provider configuration in Postgres and expose only enabled provider names/keys through `/api/client/info`. The backend owns the Authorization Code + PKCE flow, creates or finds users by normalized email, reuses existing `user_sessions`, and redirects successful callbacks to `/init`. Admin web manages provider CRUD in the settings page; client web shows provider buttons on the login page and moves post-login loading to `/init`.

**Tech Stack:** Go/Echo/Gorm/Postgres/goose, React/Vite, existing shadcn UI components, Vitest and Go tests.

---

### Task 1: Backend OIDC Schema and Admin Provider API

**Files:**
- Modify: `server/migrations/00001_init_schema.sql`
- Modify: `server/internal/store/models.go`
- Modify: `server/internal/httpserver/server.go`
- Create: `server/internal/httpserver/oidc_admin_handlers.go`
- Test: `server/internal/httpserver/server_test.go`
- Test: `server/internal/store/migrations_test.go`

- [ ] Write failing Go tests proving the migration contains `oidc_providers` and `oidc_login_states`, and that admin can create/list/update/disable/delete providers with full `client_secret` round-trip.
- [ ] Run targeted Go tests and verify they fail because routes/tables do not exist.
- [ ] Add store models, migration SQL, route registration, request/response validation, and admin CRUD handlers.
- [ ] Run targeted Go tests and verify they pass.

### Task 2: Backend Client Info and OIDC Login Flow

**Files:**
- Modify: `server/internal/httpserver/settings_handlers.go`
- Create: `server/internal/httpserver/oidc_client_handlers.go`
- Modify: `server/internal/httpserver/server.go`
- Test: `server/internal/httpserver/server_test.go`

- [ ] Write failing tests proving `/api/client/info` includes enabled OIDC providers only, start redirects to the provider authorize URL with PKCE parameters, callback exchanges the code, reads userinfo fields, creates or finds a user by email, normalizes unique phone, creates a `user_session`, and redirects to `/init`.
- [ ] Run targeted Go tests and verify expected failure.
- [ ] Implement client info expansion and OIDC start/callback flow with state hashing, state consumption, token exchange, userinfo parsing, and existing session cookie creation.
- [ ] Run targeted Go tests and verify they pass.

### Task 3: Client Web Login and Init Route

**Files:**
- Modify: `client-web/src/lib/app-info.ts`
- Modify: `client-web/src/pages/login-page.tsx`
- Modify: `client-web/src/components/login-form.tsx`
- Modify: `client-web/src/App.tsx`
- Test: `client-web/src/App.test.tsx`
- Test: `client-web/src/lib/app-info.test.ts`

- [ ] Write failing tests proving app info parses OIDC providers, login page shows provider buttons, clicking a provider navigates to `/api/client/auth/oidc/{key}/start?redirect=/init`, password login navigates to `/init`, and `/init` shows the existing loading flow before `/chat`.
- [ ] Run targeted Vitest tests and verify expected failure.
- [ ] Implement provider parsing, login UI buttons, password redirect change, and `/init` route using the existing authenticated data-loading gate.
- [ ] Run targeted Vitest tests and verify they pass.

### Task 4: Admin Web Provider Management UI

**Files:**
- Modify: `admin-web/src/lib/admin-settings.ts`
- Modify: `admin-web/src/pages/settings-page.tsx`
- Test: `admin-web/src/lib/admin-settings.test.ts`
- Test: `admin-web/src/pages/settings-page.test.tsx`

- [ ] Write failing tests proving admin settings API can list/create/update/delete OIDC providers with `client_secret`, and settings page can render and save a provider.
- [ ] Run targeted Vitest tests and verify expected failure.
- [ ] Implement admin API client types and a settings page section for OIDC provider CRUD using existing UI components.
- [ ] Run targeted Vitest tests and verify they pass.

### Task 5: Verification

**Files:**
- All touched files.

- [ ] Run `go test ./...` in `server`.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` in `client-web`.
- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` in `admin-web`.
- [ ] Run `git diff --check`.
