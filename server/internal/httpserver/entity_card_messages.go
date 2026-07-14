package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

const (
	messageTypeEntityCard = "entity_card"

	entityCardTypeUser    = "user"
	entityCardTypeApp     = "app"
	entityCardTypeGroup   = "group"
	entityCardTypeProject = "project"
	entityCardTypeTask    = "task"
)

var errEntityCardNotFound = errors.New("对象不存在或无权访问")

type entityCardRequestError struct {
	message string
}

func (err *entityCardRequestError) Error() string {
	return err.message
}

type entityCardMessageBody struct {
	EntityID   string `json:"entity_id"`
	EntityType string `json:"entity_type"`
	Type       string `json:"type"`
}

type entityCardBuilder func(*Server, context.Context, string, string) (cardMessageBody, error)

var entityCardBuilders = map[string]entityCardBuilder{
	entityCardTypeUser:    buildUserEntityCard,
	entityCardTypeApp:     buildAppEntityCard,
	entityCardTypeGroup:   buildGroupEntityCard,
	entityCardTypeProject: buildProjectEntityCard,
	entityCardTypeTask:    buildTaskEntityCard,
}

func isEntityCardMessageBody(raw json.RawMessage) bool {
	var envelope messageBodyEnvelope
	return json.Unmarshal(raw, &envelope) == nil && strings.TrimSpace(envelope.Type) == messageTypeEntityCard
}

func (s *Server) resolveEntityCardMessageBody(ctx context.Context, userID string, raw json.RawMessage) (json.RawMessage, error) {
	var request entityCardMessageBody
	if err := json.Unmarshal(raw, &request); err != nil {
		return nil, newEntityCardRequestError("消息体格式错误")
	}
	if strings.TrimSpace(request.Type) != messageTypeEntityCard {
		return nil, newEntityCardRequestError("消息类型错误")
	}
	userID = strings.TrimSpace(userID)
	if _, err := uuid.Parse(userID); err != nil {
		return nil, newEntityCardRequestError("授权用户 ID 格式错误")
	}
	entityType := strings.ToLower(strings.TrimSpace(request.EntityType))
	builder, ok := entityCardBuilders[entityType]
	if !ok {
		return nil, newEntityCardRequestError("不支持的对象卡片类型")
	}
	entityID := strings.TrimSpace(request.EntityID)
	if _, err := uuid.Parse(entityID); err != nil {
		return nil, newEntityCardRequestError("对象 ID 格式错误")
	}

	card, err := builder(s, ctx, userID, entityID)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(card)
	if err != nil {
		return nil, err
	}
	return (cardMessageBodyHandler{}).Normalize(ctx, encoded)
}

func buildUserEntityCard(s *Server, ctx context.Context, _ string, entityID string) (cardMessageBody, error) {
	var user store.User
	err := s.db.WithContext(ctx).First(&user, "id = ? AND status = ?", entityID, store.UserStatusActive).Error
	if err != nil {
		return cardMessageBody{}, mapEntityCardLookupError(err)
	}
	name := strings.TrimSpace(user.Name)
	nickname := strings.TrimSpace(user.Nickname)
	titleName := nickname
	if titleName == "" {
		titleName = name
	}
	if titleName == "" {
		titleName = strings.TrimSpace(user.Email)
	}
	title := entityCardTitle("联系人", titleName)
	description := entityCardDetails(
		entityCardDetail{Label: "姓名", Value: user.Name},
		entityCardDetail{Label: "昵称", Value: user.Nickname},
		entityCardDetail{Label: "邮箱", Value: user.Email},
	)

	return newEntityCard(title, description, "/contacts/user/"+user.ID), nil
}

func buildAppEntityCard(s *Server, ctx context.Context, userID string, entityID string) (cardMessageBody, error) {
	var app store.App
	err := s.db.WithContext(ctx).
		Where("id = ? AND enabled = ?", entityID, true).
		Where(
			"visibility = ? OR (visibility = ? AND creator_user_id = ?)",
			store.AppVisibilityPublic,
			store.AppVisibilityCreator,
			userID,
		).
		First(&app).Error
	if err != nil {
		return cardMessageBody{}, mapEntityCardLookupError(err)
	}

	return newEntityCard(
		entityCardTitle("应用", app.Name),
		entityCardPlainTextExcerpt(app.Description, 240),
		"/contacts/app/"+app.ID,
	), nil
}

func buildGroupEntityCard(s *Server, ctx context.Context, userID string, entityID string) (cardMessageBody, error) {
	memberExistsSQL := "EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = conversations.id AND cm.member_type = ? AND cm.member_id = ? AND cm.left_at IS NULL)"
	var group store.Conversation
	err := s.db.WithContext(ctx).
		Where("id = ? AND kind = ? AND status = ?", entityID, store.ConversationKindGroup, store.ConversationStatusActive).
		Where("visibility = ? OR "+memberExistsSQL, store.ConversationVisibilityPublic, store.ConversationMemberTypeUser, userID).
		First(&group).Error
	if err != nil {
		return cardMessageBody{}, mapEntityCardLookupError(err)
	}
	var memberCount int64
	if err := s.db.WithContext(ctx).Model(&store.ConversationMember{}).
		Where("conversation_id = ? AND member_type = ? AND left_at IS NULL", group.ID, store.ConversationMemberTypeUser).
		Count(&memberCount).Error; err != nil {
		return cardMessageBody{}, err
	}

	return newEntityCard(
		entityCardTitle("群聊", group.Name),
		fmt.Sprintf("%d 位成员", memberCount),
		"/contacts/group/"+group.ID,
	), nil
}

func buildProjectEntityCard(s *Server, ctx context.Context, userID string, entityID string) (cardMessageBody, error) {
	project, _, err := s.findAccessibleProject(ctx, entityID, userID)
	if err != nil {
		return cardMessageBody{}, mapEntityCardLookupError(err)
	}
	description := entityCardPlainTextExcerpt(project.Description, 240)
	if description == "" {
		description = "暂无描述"
	}

	return newEntityCard(
		entityCardTitle("项目", project.Name),
		description,
		"/projects/"+project.ID,
	), nil
}

func buildTaskEntityCard(s *Server, ctx context.Context, userID string, entityID string) (cardMessageBody, error) {
	var task store.Task
	if err := s.db.WithContext(ctx).
		Preload("AssigneeUser").
		First(&task, "id = ?", entityID).Error; err != nil {
		return cardMessageBody{}, mapEntityCardLookupError(err)
	}
	project, _, err := s.findAccessibleProject(ctx, task.ProjectID, userID)
	if err != nil {
		return cardMessageBody{}, mapEntityCardLookupError(err)
	}
	assignee := ""
	if task.AssigneeUser != nil {
		assignee = userDisplayName(*task.AssigneeUser)
	}
	dueDate := ""
	if task.DueDate != nil {
		dueDate = task.DueDate.Format("2006-01-02")
	}
	description := entityCardDetails(
		entityCardDetail{Label: "状态", Value: entityCardTaskStatusLabel(task.Status)},
		entityCardDetail{Label: "负责人", Value: assignee},
		entityCardDetail{Label: "截止日期", Value: dueDate},
	)

	return newEntityCard(
		entityCardTitle("任务", task.Title),
		description,
		fmt.Sprintf("/projects/%s?taskId=%s", project.ID, task.ID),
	), nil
}

func newEntityCard(title string, description string, url string) cardMessageBody {
	return cardMessageBody{
		Description: strings.TrimSpace(description),
		Title:       strings.TrimSpace(title),
		Type:        messageTypeCard,
		URL:         url,
	}
}

func entityCardTitle(entityLabel string, entityName string) string {
	prefix := strings.TrimSpace(entityLabel) + " - "
	name := []rune(strings.TrimSpace(entityName))
	remaining := maxCardTitleLength - len([]rune(prefix))
	if len(name) <= remaining {
		return prefix + string(name)
	}
	if remaining <= 1 {
		return string([]rune(prefix)[:maxCardTitleLength])
	}
	return prefix + string(name[:remaining-1]) + "…"
}

type entityCardDetail struct {
	Label string
	Value string
}

func entityCardDetails(details ...entityCardDetail) string {
	lines := make([]string, 0, len(details))
	for _, detail := range details {
		label := strings.TrimSpace(detail.Label)
		value := strings.TrimSpace(detail.Value)
		if label == "" || value == "" {
			continue
		}
		lines = append(lines, label+": "+value)
	}
	return strings.Join(lines, "\n")
}

func entityCardPlainTextExcerpt(source string, limit int) string {
	plainText, err := extractMarkdownPlainTextSummary(strings.TrimSpace(source))
	if err != nil {
		plainText = source
	}
	plainText = strings.Join(strings.Fields(plainText), " ")
	characters := []rune(plainText)
	if len(characters) <= limit {
		return plainText
	}
	return strings.TrimSpace(string(characters[:limit])) + "…"
}

func entityCardTaskStatusLabel(status string) string {
	switch status {
	case store.TaskStatusTodo:
		return "待办"
	case store.TaskStatusInProgress:
		return "进行中"
	case store.TaskStatusDone:
		return "已完成"
	case store.TaskStatusCanceled:
		return "已取消"
	default:
		return status
	}
}

func mapEntityCardLookupError(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errEntityCardNotFound
	}
	return err
}

func newEntityCardRequestError(message string) error {
	return &entityCardRequestError{message: message}
}
