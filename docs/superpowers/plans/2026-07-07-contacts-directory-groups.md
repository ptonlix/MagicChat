# Contacts Directory Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified client contacts directory with apps, users, public groups, group visibility controls, and public group join flow.

**Architecture:** The backend exposes a new unified contacts API and group/app conversation actions while preserving the existing users-only contacts route. The frontend keeps `contacts` as user contacts for compatibility, adds `contactApps` and `contactGroups`, and renders a grouped collapsible directory.

**Tech Stack:** Go/Echo/GORM/Postgres migrations, React/TypeScript/Vite, shadcn UI components, Vitest and Go tests.

---

### Task 1: Backend schema and contact API

**Files:**
- Modify: `server/migrations/00001_init_schema.sql`
- Modify: `server/internal/store/models.go`
- Modify: `server/internal/store/migrations_test.go`
- Modify: `server/internal/httpserver/contact_handlers.go`
- Modify: `server/internal/httpserver/server.go`
- Test: `server/internal/httpserver/server_test.go`

- [ ] **Step 1: Write failing backend contacts tests**

Add tests in `server/internal/httpserver/server_test.go` that:
- seed enabled public app, enabled creator app, disabled app, public group, private joined group, private unjoined group
- call `GET /api/client/contacts`
- assert visible apps follow enabled plus public-or-creator rule
- assert users are returned under `users`
- assert groups include joined private groups and public groups with `joined` flags

Run: `go test ./internal/httpserver -run 'TestClientContacts'`
Expected: FAIL because `/api/client/contacts` does not exist.

- [ ] **Step 2: Add schema/model visibility**

Add `ConversationVisibilityPrivate` and `ConversationVisibilityPublic` constants, add `Visibility string` to `store.Conversation`, and add a `visibility text NOT NULL DEFAULT 'private'` column plus check constraint to `conversations`.

- [ ] **Step 3: Implement unified contacts API**

Add `listClientContacts` response structs in `contact_handlers.go`, keep `listContactUsers` as compatibility, add app and group response builders, and register `client.GET("/contacts", server.listClientContacts)` before the users route.

- [ ] **Step 4: Verify backend contacts tests**

Run: `go test ./internal/httpserver -run 'TestClientContacts'`
Expected: PASS.

### Task 2: Backend app conversation and group actions

**Files:**
- Modify: `server/internal/httpserver/conversation_handlers.go`
- Modify: `server/internal/httpserver/server.go`
- Modify: `server/internal/httpserver/server_test.go`
- Modify: `server/internal/store/migrations_test.go`
- Modify: `server/internal/store/models.go`

- [ ] **Step 1: Write failing app/group action tests**

Add tests in `server/internal/httpserver/server_test.go` for:
- `POST /api/client/conversations/apps` creates or reuses an app conversation only for visible enabled apps
- group owner can set group public and private
- non-owner cannot set group public or private
- joining a public group adds current user, creates system message, returns a conversation
- joining private group is forbidden
- joining at 100 members fails

Run: `go test ./internal/httpserver -run 'TestClient(AppConversation|GroupVisibility|JoinPublicGroup)'`
Expected: FAIL because routes do not exist.

- [ ] **Step 2: Lower group member cap**

Change `maxGroupConversationMembers` in `conversation_handlers.go` from 200 to 100 and update error text/tests to `群聊成员不能超过 100 人`.

- [ ] **Step 3: Add app conversation endpoint**

Implement `createAppConversationRequest`, response wrapper compatible with `createDirectConversationResponse`, visible-app checks, `getOrCreateAppConversation`, and route `client.POST("/conversations/apps", server.createAppConversation)`.

- [ ] **Step 4: Add group visibility endpoints**

Implement `setGroupConversationVisibility` with owner-only checks, idempotent behavior, conversation update, system message creation, realtime notification, and routes:
- `POST /api/client/conversations/groups/:conversation_id/public`
- `POST /api/client/conversations/groups/:conversation_id/private`

- [ ] **Step 5: Add public group join endpoint**

Implement `joinPublicGroupConversation` with public-only access, active group check, cap check, member restore/create behavior, system join message, realtime notification, and route:
- `POST /api/client/conversations/groups/:conversation_id/join`

- [ ] **Step 6: Verify backend action tests**

Run: `go test ./internal/httpserver -run 'TestClient(AppConversation|GroupVisibility|JoinPublicGroup)'`
Expected: PASS.

### Task 3: Frontend API and provider data

**Files:**
- Modify: `client-web/src/lib/client-data-api.ts`
- Modify: `client-web/src/lib/client-data-api.test.ts`
- Modify: `client-web/src/lib/client-data-context.ts`
- Modify: `client-web/src/components/client-data-provider.tsx`
- Modify: `client-web/src/lib/client-data-context.test.tsx`

- [ ] **Step 1: Write failing client API tests**

Add tests for:
- `listClientContacts` calls `/api/client/contacts` and returns `{ apps, users, groups }`
- `openAppConversation` posts app ID and returns conversation
- `joinGroupConversation` posts join endpoint and returns conversation/message
- `setGroupConversationPublic` and `setGroupConversationPrivate` post visibility endpoints and return conversation/message

Run: `pnpm test src/lib/client-data-api.test.ts`
Expected: FAIL because types/functions are missing or endpoint paths differ.

- [ ] **Step 2: Implement client API types/functions**

Add `ContactApp`, `ContactGroup`, unified contacts normalizer, app conversation, group join, and group visibility API functions. Preserve exported `ContactUser` and the `contacts` user-list shape in provider consumers.

- [ ] **Step 3: Update provider state/actions**

Add `contactApps`, `contactGroups`, `openAppConversation`, `joinGroupConversation`, `setGroupConversationPublic`, and `setGroupConversationPrivate` to provider/context. Refresh contacts after group visibility/join changes and upsert returned conversations/messages.

- [ ] **Step 4: Verify frontend data tests**

Run: `pnpm test src/lib/client-data-api.test.ts src/lib/client-data-context.test.tsx`
Expected: PASS.

### Task 4: Frontend grouped contacts UI

**Files:**
- Modify: `client-web/src/pages/contacts-page.tsx`
- Modify: `client-web/src/App.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add App tests that show:
- contacts page renders collapsible groups `应用`, `联系人`, `群组`
- apps appear above users, groups appear below users
- selecting an unjoined public group shows `加入群聊`
- selecting a joined group shows `发消息`

Run: `pnpm test src/App.test.tsx`
Expected: FAIL because contacts page still renders a flat user list.

- [ ] **Step 2: Implement grouped contacts page**

Refactor `contacts-page.tsx` to a typed selected item union, grouped collapsible sections, app/user/group list items, and detail panels. Use existing `Item`, `Avatar`, `Button`, `ScrollArea`; keep the layout dense and avoid nested cards.

- [ ] **Step 3: Wire actions**

Connect app `发消息` to `openAppConversation`, joined group `发消息` to navigation, and unjoined group `加入群聊` to `joinGroupConversation` then navigation.

- [ ] **Step 4: Verify UI tests**

Run: `pnpm test src/App.test.tsx`
Expected: PASS.

### Task 5: Group info sheet visibility controls

**Files:**
- Modify: `client-web/src/components/group-conversation-info.tsx`
- Modify: `client-web/src/lib/client-data-api.ts`
- Modify: `client-web/src/App.test.tsx`

- [ ] **Step 1: Write failing sheet tests**

Add App tests that:
- owner sees `设置为公开群` for private group and confirmation dialog
- owner sees `取消公开群` for public group and confirmation dialog
- regular member does not see either operation

Run: `pnpm test src/App.test.tsx`
Expected: FAIL because sheet has no visibility controls.

- [ ] **Step 2: Implement sheet controls**

Add visibility status, owner-only action buttons, shadcn `AlertDialog` confirmations, and calls to provider visibility actions. Use existing group role sorting and current member lookup.

- [ ] **Step 3: Verify sheet tests**

Run: `pnpm test src/App.test.tsx`
Expected: PASS.

### Task 6: Full verification and docs

**Files:**
- Generated by commit hook if API annotations changed: `api-docs/swagger.json`, `api-docs/swagger.yaml`

- [ ] **Step 1: Run backend verification**

Run: `go test ./...` in `server`
Expected: PASS.

- [ ] **Step 2: Run client verification**

Run in `client-web`:
- `pnpm lint`
- `pnpm build`
- `pnpm test`

Expected: PASS.

- [ ] **Step 3: Commit implementation**

Run:
- `git status --short --branch`
- `git add -A`
- `git commit -m "feat: add grouped contacts directory"`

Expected: commit succeeds and worktree is clean except any intentionally untracked local runtime files.
