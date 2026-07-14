package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"app/internal/store"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	forwardMessageModeMerged      = "merged"
	forwardMessageModeSeparate    = "separate"
	maxForwardBundleDepth         = 5
	maxForwardMessageCount        = 50
	maxForwardTargetCount         = 20
	maxForwardSummaryPreviewRunes = 100
	messageTypeForwardBundle      = "forward_bundle"
)

var (
	errForwardContentUnavailable = errors.New("forward content unavailable")
	errForwardMessageLimit       = errors.New("forward message limit exceeded")
	errForwardSourceUnavailable  = errors.New("forward source unavailable")
	errForwardUnsupportedMessage = errors.New("forward unsupported message")
)

type forwardMessagesRequest struct {
	ClientForwardID       string   `json:"client_forward_id"`
	MessageIDs            []string `json:"message_ids"`
	Mode                  string   `json:"mode"`
	TargetConversationIDs []string `json:"target_conversation_ids"`
}

type normalizedForwardMessagesRequest struct {
	ClientForwardID       string
	MessageIDs            []string
	Mode                  string
	TargetConversationIDs []string
}

type forwardMessagesResponse struct {
	FailedCount int                           `json:"failed_count"`
	Results     []forwardMessagesTargetResult `json:"results"`
	SentCount   int                           `json:"sent_count"`
}

type forwardMessagesTargetResult struct {
	ConversationID string                      `json:"conversation_id"`
	Error          *forwardMessagesTargetError `json:"error,omitempty"`
	Messages       []messageResponse           `json:"messages,omitempty"`
	Status         string                      `json:"status"`
}

type forwardMessagesTargetError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type forwardBundleMessageBody struct {
	ItemCount int                 `json:"item_count"`
	Items     []forwardBundleItem `json:"items"`
	Type      string              `json:"type"`
}

type forwardBundleItem struct {
	Body       json.RawMessage `json:"body"`
	SenderName string          `json:"sender_name"`
	SenderType string          `json:"sender_type"`
	SentAt     time.Time       `json:"sent_at"`
	Summary    string          `json:"summary"`
}

type forwardBodyMetrics struct {
	BundleDepth int
	LeafCount   int
}

type preparedForwardSource struct {
	Body       json.RawMessage
	MessageID  string
	Metrics    forwardBodyMetrics
	SenderName string
	SenderType string
	SentAt     time.Time
	Summary    string
}

type forwardMessageDraft struct {
	Body            json.RawMessage
	ClientMessageID string
	Summary         string
}

// forwardConversationMessages godoc
//
// @Summary 转发会话消息
// @Description 将同一源会话中的一条或多条可见消息逐条或合并转发到多个目标会话。目标会话之间允许部分成功。
// @Tags 客户端消息
// @Accept json
// @Produce json
// @Param conversation_id path string true "源会话 ID"
// @Param body body forwardMessagesRequest true "转发请求"
// @Success 200 {object} successEnvelope{data=forwardMessagesResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 403 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/conversations/{conversation_id}/messages/forward [post]
func (s *Server) forwardConversationMessages(c echo.Context) error {
	user, ok := currentUser(c)
	if !ok {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	sourceConversationID, err := normalizeMessageConversationID(c.Param("conversation_id"))
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}

	var rawRequest forwardMessagesRequest
	if err := c.Bind(&rawRequest); err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}
	request, err := normalizeForwardMessagesRequest(rawRequest)
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}

	sourceMessages, err := s.loadForwardSourceMessages(user.ID, sourceConversationID, request.MessageIDs)
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			return failure(c, http.StatusNotFound, "not_found", "源会话不存在")
		case errors.Is(err, errConversationAccessDenied):
			return failure(c, http.StatusForbidden, "forbidden", "无权访问源会话")
		case errors.Is(err, errForwardSourceUnavailable):
			return failure(c, http.StatusConflict, "source_unavailable", "部分源消息不存在、不可见或已被撤回")
		default:
			return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
		}
	}

	preparedSources, err := s.prepareForwardSources(c.Request().Context(), sourceMessages)
	if err != nil {
		switch {
		case errors.Is(err, errForwardMessageLimit):
			return failure(c, http.StatusBadRequest, "invalid_request", fmt.Sprintf("本次转发最多包含 %d 条原始消息", maxForwardMessageCount))
		case errors.Is(err, errForwardUnsupportedMessage):
			return failure(c, http.StatusBadRequest, "unsupported_message", "所选消息中包含不能转发的消息")
		case errors.Is(err, errForwardContentUnavailable):
			return failure(c, http.StatusConflict, "content_unavailable", "消息附件不存在或已过期")
		default:
			return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
		}
	}

	drafts, err := buildForwardMessageDrafts(request, preparedSources)
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}

	response := forwardMessagesResponse{
		Results: make([]forwardMessagesTargetResult, 0, len(request.TargetConversationIDs)),
	}
	for _, targetConversationID := range request.TargetConversationIDs {
		messages, err := s.createForwardedMessagesForTarget(c.Request().Context(), user, targetConversationID, drafts)
		if err != nil {
			response.FailedCount++
			response.Results = append(response.Results, newForwardTargetFailure(targetConversationID, err))
			continue
		}

		messageResponses := make([]messageResponse, 0, len(messages))
		for _, message := range messages {
			messageResponse, err := s.newMessageResponseForUser(c.Request().Context(), message, user.ID)
			if err != nil {
				messageResponse = newMessageResponse(message)
			}
			messageResponses = append(messageResponses, messageResponse)
		}
		response.SentCount++
		response.Results = append(response.Results, forwardMessagesTargetResult{
			ConversationID: targetConversationID,
			Messages:       messageResponses,
			Status:         "sent",
		})
	}

	return success(c, http.StatusOK, response)
}

func normalizeForwardMessagesRequest(request forwardMessagesRequest) (normalizedForwardMessagesRequest, error) {
	clientForwardID := strings.TrimSpace(request.ClientForwardID)
	parsedForwardID, err := uuid.Parse(clientForwardID)
	if err != nil {
		return normalizedForwardMessagesRequest{}, errors.New("客户端转发 ID 格式错误")
	}

	messageIDs, err := normalizeForwardUUIDs(request.MessageIDs, "消息 ID", maxForwardMessageCount)
	if err != nil {
		return normalizedForwardMessagesRequest{}, err
	}
	targetConversationIDs, err := normalizeForwardUUIDs(request.TargetConversationIDs, "目标会话 ID", maxForwardTargetCount)
	if err != nil {
		return normalizedForwardMessagesRequest{}, err
	}

	mode := strings.TrimSpace(request.Mode)
	if mode != forwardMessageModeSeparate && mode != forwardMessageModeMerged {
		return normalizedForwardMessagesRequest{}, errors.New("转发模式必须是 separate 或 merged")
	}
	if mode == forwardMessageModeMerged && len(messageIDs) < 2 {
		return normalizedForwardMessagesRequest{}, errors.New("合并转发至少需要两条消息")
	}
	return normalizedForwardMessagesRequest{
		ClientForwardID:       parsedForwardID.String(),
		MessageIDs:            messageIDs,
		Mode:                  mode,
		TargetConversationIDs: targetConversationIDs,
	}, nil
}

func normalizeForwardUUIDs(rawIDs []string, fieldName string, limit int) ([]string, error) {
	if len(rawIDs) == 0 {
		return nil, errors.New(fieldName + "不能为空")
	}
	if len(rawIDs) > limit {
		return nil, fmt.Errorf("%s一次最多传 %d 个", fieldName, limit)
	}

	ids := make([]string, 0, len(rawIDs))
	seen := make(map[string]struct{}, len(rawIDs))
	for _, rawID := range rawIDs {
		parsedID, err := uuid.Parse(strings.TrimSpace(rawID))
		if err != nil {
			return nil, errors.New(fieldName + "格式错误")
		}
		id := parsedID.String()
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}

	return ids, nil
}

func (s *Server) loadForwardSourceMessages(userID string, conversationID string, messageIDs []string) ([]store.Message, error) {
	member, err := s.requireReadableConversationMember(userID, conversationID)
	if err != nil {
		return nil, err
	}
	visibleFromSeq := member.HistoryVisibleFromSeq
	if visibleFromSeq < 1 {
		visibleFromSeq = 1
	}

	var messages []store.Message
	if err := s.db.
		Where("conversation_id = ? AND id IN ? AND deleted_at IS NULL AND seq >= ?", conversationID, messageIDs, visibleFromSeq).
		Find(&messages).Error; err != nil {
		return nil, err
	}
	if len(messages) != len(messageIDs) {
		return nil, errForwardSourceUnavailable
	}
	for _, message := range messages {
		if message.RevokedAt != nil {
			return nil, errForwardSourceUnavailable
		}
	}

	sort.Slice(messages, func(left int, right int) bool {
		return messages[left].Seq < messages[right].Seq
	})
	return messages, nil
}

func (s *Server) prepareForwardSources(ctx context.Context, messages []store.Message) ([]preparedForwardSource, error) {
	mentionLabels, err := s.loadForwardMentionLabels(ctx, messages)
	if err != nil {
		return nil, err
	}

	sources := make([]preparedForwardSource, 0, len(messages))
	for _, message := range messages {
		body, summary, metrics, err := sanitizeForwardMessageBody(message.Body, mentionLabels, 0)
		if err != nil {
			return nil, err
		}
		if message.SenderID == nil || message.SenderType == store.MessageSenderTypeSystem {
			return nil, errForwardUnsupportedMessage
		}
		senderName, err := s.messageSenderDisplayName(ctx, message.SenderType, *message.SenderID)
		if err != nil {
			return nil, err
		}
		sources = append(sources, preparedForwardSource{
			Body:       body,
			MessageID:  message.ID,
			Metrics:    metrics,
			SenderName: senderName,
			SenderType: message.SenderType,
			SentAt:     message.CreatedAt,
			Summary:    summary,
		})
	}
	if forwardSourcesLeafCount(sources) > maxForwardMessageCount {
		return nil, errForwardMessageLimit
	}

	if err := s.validateForwardTemporaryFiles(sources); err != nil {
		return nil, err
	}
	return sources, nil
}

func (s *Server) messageSenderDisplayName(ctx context.Context, senderType string, senderID string) (string, error) {
	switch senderType {
	case store.MessageSenderTypeUser:
		var user store.User
		if err := s.db.WithContext(ctx).Select("id", "name", "nickname").First(&user, "id = ?", senderID).Error; err != nil {
			return "", err
		}
		if name := strings.TrimSpace(user.Nickname); name != "" {
			return name, nil
		}
		return user.Name, nil
	case store.MessageSenderTypeApp:
		return s.messageSenderName(ctx, senderType, senderID)
	default:
		return "", errForwardUnsupportedMessage
	}
}

func (s *Server) loadForwardMentionLabels(ctx context.Context, messages []store.Message) (map[string]string, error) {
	targetsByKey := make(map[string]messageMentionTarget)
	for _, message := range messages {
		collectForwardMentionTargets(message.Body, targetsByKey)
	}
	labels := make(map[string]string, len(targetsByKey))
	for key, target := range targetsByKey {
		if target.All {
			labels[key] = "所有人"
			continue
		}
		name, err := s.messageSenderDisplayName(ctx, target.MemberType, target.MemberID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if target.MemberType == store.ConversationMemberTypeApp {
				name = "应用"
			} else {
				name = "用户"
			}
		} else if err != nil {
			return nil, err
		}
		labels[key] = name
	}
	return labels, nil
}

func collectForwardMentionTargets(body json.RawMessage, targets map[string]messageMentionTarget) {
	collectForwardMentionTargetsAtDepth(body, targets, 0)
}

func collectForwardMentionTargetsAtDepth(body json.RawMessage, targets map[string]messageMentionTarget, bundleDepth int) {
	var envelope messageBodyEnvelope
	if json.Unmarshal(body, &envelope) != nil {
		return
	}
	if envelope.Type == messageTypeForwardBundle {
		if bundleDepth >= maxForwardBundleDepth {
			return
		}
		var bundle forwardBundleMessageBody
		if json.Unmarshal(body, &bundle) != nil {
			return
		}
		for _, item := range bundle.Items {
			collectForwardMentionTargetsAtDepth(item.Body, targets, bundleDepth+1)
		}
		return
	}
	for _, target := range parseMessageMentionTargets(body) {
		key := "all"
		if !target.All {
			key = conversationMemberMentionKey(target.MemberType, target.MemberID)
		}
		targets[key] = target
	}
}

func sanitizeForwardMessageBody(raw json.RawMessage, mentionLabels map[string]string, bundleDepth int) (json.RawMessage, string, forwardBodyMetrics, error) {
	var envelope messageBodyEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return nil, "", forwardBodyMetrics{}, errForwardUnsupportedMessage
	}

	leafMetrics := forwardBodyMetrics{LeafCount: 1}
	switch strings.TrimSpace(envelope.Type) {
	case messageTypeText:
		body, err := decodeTextMessageBody(raw)
		if err != nil {
			return nil, "", forwardBodyMetrics{}, errForwardUnsupportedMessage
		}
		body.Content = replaceForwardMentions(body.Content, mentionLabels, false)
		encoded, err := json.Marshal(body)
		return encoded, strings.TrimSpace(body.Content), leafMetrics, err
	case messageTypeMarkdown:
		body, err := decodeMarkdownMessageBody(raw)
		if err != nil {
			return nil, "", forwardBodyMetrics{}, errForwardUnsupportedMessage
		}
		body.Content = replaceForwardMentions(body.Content, mentionLabels, true)
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, "", forwardBodyMetrics{}, err
		}
		summary, err := extractMarkdownPlainTextSummary(strings.TrimSpace(body.Content))
		return encoded, summary, leafMetrics, err
	case messageTypeLink:
		summary, err := (linkMessageBodyHandler{}).Summary(raw)
		return cloneRawMessage(raw), summary, leafMetrics, err
	case messageTypeCard:
		handler := cardMessageBodyHandler{}
		if err := handler.Validate(raw); err != nil {
			return nil, "", forwardBodyMetrics{}, errForwardUnsupportedMessage
		}
		summary, err := handler.Summary(raw)
		return cloneRawMessage(raw), summary, leafMetrics, err
	case messageTypeFile:
		var body fileMessageBody
		if json.Unmarshal(raw, &body) != nil || strings.TrimSpace(body.FileID) == "" || strings.TrimSpace(body.Name) == "" {
			return nil, "", forwardBodyMetrics{}, errForwardUnsupportedMessage
		}
		return cloneRawMessage(raw), fileMessageSummary(body.Name), leafMetrics, nil
	case messageTypeImage:
		var body imageMessageBody
		if json.Unmarshal(raw, &body) != nil || strings.TrimSpace(body.FileID) == "" {
			return nil, "", forwardBodyMetrics{}, errForwardUnsupportedMessage
		}
		return cloneRawMessage(raw), imageMessageSummary(), leafMetrics, nil
	case messageTypeVoice:
		var body voiceMessageBody
		if json.Unmarshal(raw, &body) != nil || strings.TrimSpace(body.FileID) == "" || body.DurationMS <= 0 {
			return nil, "", forwardBodyMetrics{}, errForwardUnsupportedMessage
		}
		return cloneRawMessage(raw), voiceMessageSummary(body.DurationMS, body.Transcript), leafMetrics, nil
	case messageTypeForwardBundle:
		return sanitizeForwardBundleBody(raw, mentionLabels, bundleDepth)
	default:
		return nil, "", forwardBodyMetrics{}, errForwardUnsupportedMessage
	}
}

func sanitizeForwardBundleBody(raw json.RawMessage, mentionLabels map[string]string, enclosingBundleDepth int) (json.RawMessage, string, forwardBodyMetrics, error) {
	if enclosingBundleDepth >= maxForwardBundleDepth {
		return nil, "", forwardBodyMetrics{}, errForwardUnsupportedMessage
	}
	var bundle forwardBundleMessageBody
	if err := json.Unmarshal(raw, &bundle); err != nil || bundle.Type != messageTypeForwardBundle || len(bundle.Items) == 0 {
		return nil, "", forwardBodyMetrics{}, errForwardUnsupportedMessage
	}
	if len(bundle.Items) > maxForwardMessageCount {
		return nil, "", forwardBodyMetrics{}, errForwardUnsupportedMessage
	}

	items := make([]forwardBundleItem, 0, len(bundle.Items))
	metrics := forwardBodyMetrics{BundleDepth: 1}
	for _, item := range bundle.Items {
		if strings.TrimSpace(item.SenderName) == "" ||
			(item.SenderType != store.MessageSenderTypeUser && item.SenderType != store.MessageSenderTypeApp) ||
			item.SentAt.IsZero() {
			return nil, "", forwardBodyMetrics{}, errForwardUnsupportedMessage
		}
		body, summary, childMetrics, err := sanitizeForwardMessageBody(item.Body, mentionLabels, enclosingBundleDepth+1)
		if err != nil {
			return nil, "", forwardBodyMetrics{}, err
		}
		item.Body = body
		item.Summary = summary
		items = append(items, item)
		metrics.LeafCount += childMetrics.LeafCount
		metrics.BundleDepth = max(metrics.BundleDepth, childMetrics.BundleDepth+1)
		if metrics.LeafCount > maxForwardMessageCount {
			return nil, "", forwardBodyMetrics{}, errForwardUnsupportedMessage
		}
	}

	bundle.ItemCount = len(items)
	bundle.Items = items
	encoded, err := json.Marshal(bundle)
	if err != nil {
		return nil, "", forwardBodyMetrics{}, err
	}
	return encoded, forwardBundleSummary(items), metrics, nil
}

func replaceForwardMentions(content string, labels map[string]string, markdown bool) string {
	return messageMentionTokenPattern.ReplaceAllStringFunc(content, func(token string) string {
		match := messageMentionTokenPattern.FindStringSubmatch(token)
		if len(match) != 5 {
			return token
		}
		key := "all"
		if match[2] != "all" {
			key = conversationMemberMentionKey(match[3], strings.ToLower(match[4]))
		}
		label := labels[key]
		if label == "" {
			if match[2] == "all" {
				label = "所有人"
			} else if match[3] == store.ConversationMemberTypeApp {
				label = "应用"
			} else {
				label = "用户"
			}
		}
		if markdown {
			label = escapeForwardMarkdownText(label)
		}
		return "@" + label
	})
}

func escapeForwardMarkdownText(content string) string {
	replacer := strings.NewReplacer(
		"\\", "\\\\",
		"*", "\\*",
		"_", "\\_",
		"[", "\\[",
		"]", "\\]",
		"<", "\\<",
		">", "\\>",
		"`", "\\`",
	)
	return replacer.Replace(content)
}

func cloneRawMessage(raw json.RawMessage) json.RawMessage {
	return append(json.RawMessage(nil), raw...)
}

func (s *Server) validateForwardTemporaryFiles(sources []preparedForwardSource) error {
	fileIDSet := make(map[string]struct{})
	for _, source := range sources {
		collectForwardTemporaryFileIDs(source.Body, fileIDSet)
	}
	if len(fileIDSet) == 0 {
		return nil
	}

	fileIDs := make([]string, 0, len(fileIDSet))
	for fileID := range fileIDSet {
		fileIDs = append(fileIDs, fileID)
	}
	var files []store.TemporaryFile
	if err := s.db.Where("id IN ?", fileIDs).Find(&files).Error; err != nil {
		return err
	}
	if len(files) != len(fileIDs) {
		return errForwardContentUnavailable
	}
	now := time.Now().UTC()
	for _, file := range files {
		if isTemporaryFileExpired(file, s.cfg.Storage.Lifecycle.TemporaryExpireDays, now) {
			return errForwardContentUnavailable
		}
	}
	return nil
}

func collectForwardTemporaryFileIDs(raw json.RawMessage, fileIDs map[string]struct{}) {
	var envelope messageBodyEnvelope
	if json.Unmarshal(raw, &envelope) != nil {
		return
	}
	switch envelope.Type {
	case messageTypeFile:
		var body fileMessageBody
		if json.Unmarshal(raw, &body) == nil && body.FileID != "" {
			fileIDs[body.FileID] = struct{}{}
		}
	case messageTypeImage:
		var body imageMessageBody
		if json.Unmarshal(raw, &body) == nil && body.FileID != "" {
			fileIDs[body.FileID] = struct{}{}
		}
	case messageTypeVoice:
		var body voiceMessageBody
		if json.Unmarshal(raw, &body) == nil && body.FileID != "" {
			fileIDs[body.FileID] = struct{}{}
		}
	case messageTypeForwardBundle:
		var body forwardBundleMessageBody
		if json.Unmarshal(raw, &body) == nil {
			for _, item := range body.Items {
				collectForwardTemporaryFileIDs(item.Body, fileIDs)
			}
		}
	}
}

func buildForwardMessageDrafts(request normalizedForwardMessagesRequest, sources []preparedForwardSource) ([]forwardMessageDraft, error) {
	if forwardSourcesLeafCount(sources) > maxForwardMessageCount {
		return nil, fmt.Errorf("本次转发最多包含 %d 条原始消息", maxForwardMessageCount)
	}
	if request.Mode == forwardMessageModeSeparate {
		drafts := make([]forwardMessageDraft, 0, len(sources))
		for _, source := range sources {
			drafts = append(drafts, forwardMessageDraft{
				Body:            source.Body,
				ClientMessageID: "forward:" + request.ClientForwardID + ":" + source.MessageID,
				Summary:         source.Summary,
			})
		}
		return drafts, nil
	}

	items := make([]forwardBundleItem, 0, len(sources))
	metrics := forwardBodyMetrics{BundleDepth: 1}
	for _, source := range sources {
		items = append(items, forwardBundleItem{
			Body:       source.Body,
			SenderName: source.SenderName,
			SenderType: source.SenderType,
			SentAt:     source.SentAt,
			Summary:    source.Summary,
		})
		metrics.BundleDepth = max(metrics.BundleDepth, source.Metrics.BundleDepth+1)
	}
	if metrics.BundleDepth > maxForwardBundleDepth {
		return nil, fmt.Errorf("聊天记录最多嵌套 %d 层", maxForwardBundleDepth)
	}
	body, err := json.Marshal(forwardBundleMessageBody{
		ItemCount: len(items),
		Items:     items,
		Type:      messageTypeForwardBundle,
	})
	if err != nil {
		return nil, err
	}
	return []forwardMessageDraft{{
		Body:            body,
		ClientMessageID: "forward:" + request.ClientForwardID,
		Summary:         forwardBundleSummary(items),
	}}, nil
}

func forwardSourcesLeafCount(sources []preparedForwardSource) int {
	count := 0
	for _, source := range sources {
		count += source.Metrics.LeafCount
	}
	return count
}

func forwardBundleSummary(items []forwardBundleItem) string {
	if len(items) == 0 {
		return "[聊天记录] 0 条"
	}
	preview := truncateForwardSummary(strings.TrimSpace(items[0].Summary), maxForwardSummaryPreviewRunes)
	if preview == "" {
		preview = "消息"
	}
	return fmt.Sprintf("[聊天记录] %d 条 - %s", len(items), preview)
}

func truncateForwardSummary(content string, limit int) string {
	if limit <= 0 || utf8.RuneCountInString(content) <= limit {
		return content
	}
	runes := []rune(content)
	return strings.TrimSpace(string(runes[:limit])) + "…"
}

func (s *Server) createForwardedMessagesForTarget(ctx context.Context, user store.User, conversationID string, drafts []forwardMessageDraft) ([]store.Message, error) {
	var messages []store.Message
	var createdMessages []store.Message
	var memberUserIDs []string
	var outboxEvents []store.AppEventOutbox
	appEventLockHeld := false

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var conversation store.Conversation
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&conversation, "id = ?", conversationID).Error; err != nil {
			return err
		}
		if conversation.Status != store.ConversationStatusActive || conversation.PostingPolicy != store.ConversationPostingPolicyOpen {
			return errConversationNotSendable
		}
		var member store.ConversationMember
		if err := tx.First(
			&member,
			"conversation_id = ? AND member_type = ? AND member_id = ? AND left_at IS NULL",
			conversationID,
			store.ConversationMemberTypeUser,
			user.ID,
		).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errConversationAccessDenied
			}
			return err
		}

		clientMessageIDs := make([]string, 0, len(drafts))
		for _, draft := range drafts {
			clientMessageIDs = append(clientMessageIDs, draft.ClientMessageID)
		}
		var existingMessages []store.Message
		if err := tx.Where(
			"conversation_id = ? AND sender_type = ? AND sender_id = ? AND client_message_id IN ?",
			conversationID,
			store.MessageSenderTypeUser,
			user.ID,
			clientMessageIDs,
		).Find(&existingMessages).Error; err != nil {
			return err
		}
		existingByClientID := make(map[string]store.Message, len(existingMessages))
		for _, message := range existingMessages {
			if message.ClientMessageID != nil {
				existingByClientID[*message.ClientMessageID] = message
			}
		}

		now := time.Now().UTC()
		messages = make([]store.Message, 0, len(drafts))
		for _, draft := range drafts {
			if existing, ok := existingByClientID[draft.ClientMessageID]; ok {
				messages = append(messages, existing)
				continue
			}
			clientMessageID := draft.ClientMessageID
			message := store.Message{
				ID:              uuid.NewString(),
				ConversationID:  conversationID,
				Seq:             conversation.LastMessageSeq + 1,
				SenderType:      store.MessageSenderTypeUser,
				SenderID:        &user.ID,
				ClientMessageID: &clientMessageID,
				Body:            draft.Body,
				Summary:         draft.Summary,
				CreatedAt:       now,
				UpdatedAt:       now,
			}
			if err := tx.Create(&message).Error; err != nil {
				return err
			}
			conversation.LastMessageSeq = message.Seq
			messages = append(messages, message)
			createdMessages = append(createdMessages, message)
		}

		if len(createdMessages) > 0 {
			lastMessage := createdMessages[len(createdMessages)-1]
			if err := tx.Model(&store.Conversation{}).Where("id = ?", conversationID).Updates(map[string]any{
				"last_message_at":      lastMessage.CreatedAt,
				"last_message_id":      lastMessage.ID,
				"last_message_seq":     lastMessage.Seq,
				"last_message_summary": lastMessage.Summary,
				"updated_at":           now,
			}).Error; err != nil {
				return err
			}
			ids, err := loadActiveConversationUserIDs(tx, conversationID)
			if err != nil {
				return err
			}
			memberUserIDs = ids

			if conversation.Kind == store.ConversationKindApp {
				s.appEventMu.Lock()
				appEventLockHeld = true
				for _, message := range createdMessages {
					events, err := s.createAppMessageEventOutbox(tx, conversation, user, message)
					if err != nil {
						return err
					}
					outboxEvents = append(outboxEvents, events...)
				}
			}
		}

		var maxSeq int64
		for _, message := range messages {
			if message.Seq > maxSeq {
				maxSeq = message.Seq
			}
		}
		if maxSeq > 0 {
			return advanceConversationMemberReadSeq(tx, conversationID, user.ID, maxSeq)
		}
		return nil
	})
	if appEventLockHeld {
		defer s.appEventMu.Unlock()
	}
	if err != nil {
		return nil, err
	}

	for _, message := range createdMessages {
		s.sendRealtimeMessageCreatedToUsers(ctx, memberUserIDs, message)
		if s.afterUserMessageCommit != nil {
			s.afterUserMessageCommit(message)
		}
	}
	s.deliverStoredAppEvents(outboxEvents)
	return messages, nil
}

func newForwardTargetFailure(conversationID string, err error) forwardMessagesTargetResult {
	code := "internal_error"
	message := "转发失败"
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound), errors.Is(err, errConversationAccessDenied):
		code = "forbidden"
		message = "无权向该会话发送消息"
	case errors.Is(err, errConversationNotSendable):
		code = "conversation_not_sendable"
		message = "当前会话不能发送消息"
	}
	return forwardMessagesTargetResult{
		ConversationID: conversationID,
		Error: &forwardMessagesTargetError{
			Code:    code,
			Message: message,
		},
		Status: "failed",
	}
}
