# Chat Unread Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-conversation unread indicators backed by per-member `last_read_seq`.

**Architecture:** Store read progress on `conversation_members.last_read_seq`, return `last_read_seq` and `unread_count` from the conversation list, and expose a mark-read API that only advances read progress. The client keeps unread state in `ClientDataProvider`, updates it from `message.created`, and clears it when the user opens or stays in a visible conversation.

**Tech Stack:** Go/Echo/GORM/Postgres migrations for the server, React/TypeScript/Vite for the client, existing realtime `message.created` events.

---

### Task 1: Server Schema and Models

**Files:**
- Create: `server/migrations/00002_add_conversation_member_last_read_seq.sql`
- Modify: `server/internal/store/models.go`

- [ ] **Step 1: Create migration**

```sql
-- +goose Up
ALTER TABLE conversation_members
  ADD COLUMN last_read_seq bigint NOT NULL DEFAULT 0;

UPDATE conversation_members cm
SET last_read_seq = c.last_message_seq
FROM conversations c
WHERE c.id = cm.conversation_id;

-- +goose Down
ALTER TABLE conversation_members
  DROP COLUMN last_read_seq;
```

- [ ] **Step 2: Add model field**

Add this field to `store.ConversationMember` after `LastReadMessageID`:

```go
LastReadSeq int64 `gorm:"not null;default:0"`
```

- [ ] **Step 3: Run migration/model checks**

Run: `go test ./internal/store` from `server/`

Expected: package passes.

### Task 2: Server API Tests

**Files:**
- Modify: `server/internal/httpserver/server_test.go`

- [ ] **Step 1: Add list unread assertions**

Extend `TestListClientConversationsReturnsRecentCurrentUserConversations` to set Alice's `last_read_seq` lower than `last_message_seq` for one conversation and assert:

```go
if first["last_read_seq"] != float64(2) {
	t.Fatalf("direct last_read_seq = %v, want 2", first["last_read_seq"])
}
if first["unread_count"] != float64(3) {
	t.Fatalf("direct unread_count = %v, want 3", first["unread_count"])
}
```

- [ ] **Step 2: Add sender read-progress test**

Extend `TestCreateConversationTextMessageStoresSummaryAndUpdatesConversation` to assert Alice's `ConversationMember.LastReadSeq` becomes the new message seq and Bob remains unchanged.

- [ ] **Step 3: Add mark-read API test**

Add `TestMarkConversationReadAdvancesCurrentUserReadSeq` that creates a conversation at `last_message_seq = 8`, sets Alice to `last_read_seq = 2`, calls:

```go
postJSON(t, server, "/api/client/conversations/"+conversation.ID+"/read", map[string]any{}, loginAsUser(t, server, alice.Email))
```

and asserts response `last_read_seq = 8`, `unread_count = 0`, Alice's database row is updated, and Bob's row is unchanged.

- [ ] **Step 4: Add no-regression test**

Add `TestMarkConversationReadDoesNotRegressReadSeq` that starts Alice at `last_read_seq = 7`, posts `{ "up_to_seq": 3 }`, and asserts Alice stays at `7`.

- [ ] **Step 5: Add authorization/validation test**

Add `TestMarkConversationReadRejectsInvalidOrUnauthorizedRequests` covering missing session, invalid UUID, non-member user, and invalid `up_to_seq`.

- [ ] **Step 6: Run tests and confirm failure**

Run: `go test ./internal/httpserver -run 'Test(ListClientConversationsReturnsRecentCurrentUserConversations|CreateConversationTextMessageStoresSummaryAndUpdatesConversation|MarkConversationRead)'`

Expected: fails because response fields, model field, route, and handler are not implemented yet.

### Task 3: Server Implementation

**Files:**
- Modify: `server/internal/httpserver/server.go`
- Modify: `server/internal/httpserver/conversation_handlers.go`
- Modify: `server/internal/httpserver/message_handlers.go`
- Modify: `server/internal/store/models.go`

- [ ] **Step 1: Extend response types**

Add to `conversationListItemResponse`:

```go
LastReadSeq int64 `json:"last_read_seq" example:"9"`
UnreadCount int64 `json:"unread_count" example:"3"`
```

Add:

```go
type markConversationReadRequest struct {
	UpToSeq *int64 `json:"up_to_seq" example:"123"`
}

type markConversationReadResponse struct {
	ConversationID string `json:"conversation_id" example:"7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"`
	LastReadSeq    int64  `json:"last_read_seq" example:"123"`
	UnreadCount    int64  `json:"unread_count" example:"0"`
}
```

- [ ] **Step 2: Load current members with conversations**

Change `listClientConversations` to select the current user's `conversation_members` rows along with conversations, then pass the current member into `newConversationListItemResponse`.

- [ ] **Step 3: Calculate unread count**

Use:

```go
func unreadCount(lastMessageSeq int64, lastReadSeq int64) int64 {
	if lastReadSeq >= lastMessageSeq {
		return 0
	}
	return lastMessageSeq - lastReadSeq
}
```

- [ ] **Step 4: Add route**

Add to `server.go`:

```go
client.POST("/conversations/:conversation_id/read", server.markConversationRead)
```

- [ ] **Step 5: Implement mark-read handler**

Implement `markConversationRead` in `conversation_handlers.go`: parse conversation ID, bind optional body, validate `up_to_seq`, require active membership, clamp target seq to `last_message_seq`, update with SQL `GREATEST(last_read_seq, ?)`, reload current row, and return `markConversationReadResponse`.

- [ ] **Step 6: Advance sender read seq when sending**

In `createUserMessage`, after updating `conversations`, update the sender's `conversation_members` row:

```go
tx.Model(&store.ConversationMember{}).
	Where("conversation_id = ? AND member_type = ? AND member_id = ?", conversationID, store.ConversationMemberTypeUser, userID).
	Update("last_read_seq", gorm.Expr("GREATEST(last_read_seq, ?)", message.Seq))
```

- [ ] **Step 7: Run server tests**

Run: `go test ./...` from `server/`

Expected: all server tests pass.

### Task 4: Client API and Data State

**Files:**
- Modify: `client-web/src/lib/client-data-api.ts`
- Modify: `client-web/src/lib/client-data-context.ts`
- Modify: `client-web/src/components/client-data-provider.tsx`

- [ ] **Step 1: Extend client types**

Add `lastReadSeq: number` and `unreadCount: number` to `ClientConversation`.

- [ ] **Step 2: Normalize server fields**

In `normalizeConversation`, map:

```ts
lastReadSeq: conversation.last_read_seq ?? 0,
unreadCount: conversation.unread_count ?? 0,
```

- [ ] **Step 3: Add mark-read API**

Add `markConversationRead(conversationId: string, options?: { upToSeq?: number })` that POSTs to `/api/client/conversations/{id}/read`, sends `{ up_to_seq }` only when provided, and returns normalized `{ conversationId, lastReadSeq, unreadCount }`.

- [ ] **Step 4: Expose data actions**

Add to `ClientDataContextValue`:

```ts
markConversationRead: (conversationId: string, options?: { upToSeq?: number }) => Promise<void>
handleIncomingConversationMessage: (message: ClientMessage, options?: { activeConversationId?: string; visible?: boolean }) => void
```

- [ ] **Step 5: Implement local unread updates**

In `ClientDataProvider`, update conversations so incoming messages from another user increment unread only when not visible in the active conversation; mark-read success sets `lastReadSeq` and `unreadCount` from the response.

- [ ] **Step 6: Preserve existing message merge behavior**

Keep `mergeIncomingConversationMessage` for loaded message state, but have realtime sync call the new incoming-message handler so unread and last-message state update together.

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck` from `client-web/`

Expected: TypeScript passes after all consumers are updated.

### Task 5: Client UI and Sync Behavior

**Files:**
- Modify: `client-web/src/pages/chat-page.tsx`
- Modify: `client-web/src/components/client-conversation-realtime-sync.tsx`

- [ ] **Step 1: Show unread badge**

In the conversation list item title row, show a small red badge when `conversation.unreadCount > 0`; render `99+` for counts over 99.

- [ ] **Step 2: Mark selected conversation read**

In `ChatPage`, when `activeConversationId` changes or its `unreadCount` is positive, call `markConversationRead(activeConversationId)` silently.

- [ ] **Step 3: Add visible-conversation timer**

In `ChatPage`, while document is visible and active conversation has `unreadCount > 0`, call `markConversationRead` every 20 seconds and on `visibilitychange` to visible.

- [ ] **Step 4: Pass active state to realtime unread handler**

In `ClientConversationRealtimeSync`, use `useLocation` to find current `conversation_id`, then call `handleIncomingConversationMessage(message, { activeConversationId, visible: document.visibilityState === "visible" })`.

- [ ] **Step 5: Run client verification**

Run from `client-web/`:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all commands pass. No frontend tests are added.

### Task 6: Final Verification

**Files:**
- Verify all touched files.

- [ ] **Step 1: Run server suite**

Run: `go test ./...` from `server/`

Expected: all packages pass.

- [ ] **Step 2: Run client suite**

Run from `client-web/`:

```bash
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all commands pass.

- [ ] **Step 3: Check git state**

Run: `git status --short --branch`

Expected: only intended implementation files are modified, plus this plan and the prior design commit if not pushed yet.
