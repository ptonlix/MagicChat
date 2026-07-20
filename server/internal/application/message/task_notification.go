package message

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	conversationapp "app/internal/application/conversation"
	taskapp "app/internal/application/task"
	"app/internal/appregistry"
	"app/internal/store"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func (s *Service) PrepareTaskNotification(
	ctx context.Context,
	tx *gorm.DB,
	cmd TaskNotificationCommand,
) (*TaskNotificationBatchResult, error) {
	recipientIDs := taskNotificationRecipientIDs(cmd)
	if len(recipientIDs) == 0 {
		return nil, nil
	}
	recipients := make([]store.User, 0, len(recipientIDs))
	for _, recipientID := range recipientIDs {
		recipient, valid, err := taskapp.ResolveNotificationRecipient(
			tx.WithContext(ctx), cmd.ProjectID, recipientID,
		)
		if err != nil {
			return nil, err
		}
		if valid {
			recipients = append(recipients, recipient)
		}
	}
	if len(recipients) == 0 {
		return nil, nil
	}
	assistant, err := s.loadTaskNotificationAssistantApp(ctx, tx)
	if err != nil {
		return nil, err
	}
	if !assistant.Enabled {
		return nil, nil
	}
	if s.taskNotificationBodies == nil {
		return nil, errors.New("task notification body builder is required")
	}
	cmd.AssigneeName, err = loadTaskNotificationAssigneeName(ctx, tx, cmd.AssigneeUserID)
	if err != nil {
		return nil, err
	}
	body, summary, err := s.taskNotificationBodies.BuildTaskNotificationBody(ctx, cmd)
	if err != nil {
		return nil, err
	}
	batch := &TaskNotificationBatchResult{Notifications: make([]TaskNotificationResult, 0, len(recipients))}
	for _, recipient := range recipients {
		notification, err := s.prepareTaskNotificationForRecipient(
			ctx, tx, cmd, assistant, recipient, body, summary,
		)
		if err != nil {
			return nil, err
		}
		batch.Notifications = append(batch.Notifications, notification)
	}
	return batch, nil
}

func (s *Service) prepareTaskNotificationForRecipient(
	ctx context.Context,
	tx *gorm.DB,
	cmd TaskNotificationCommand,
	assistant store.App,
	recipient store.User,
	body json.RawMessage,
	summary string,
) (TaskNotificationResult, error) {
	conversation, err := conversationapp.EnsureBuiltinAssistantConversationTx(
		tx.WithContext(ctx), assistant, recipient, s.nowUTC(),
	)
	if err != nil {
		return TaskNotificationResult{}, err
	}
	clientMessageID := fmt.Sprintf(
		"task-notification:%s:%d:%s", cmd.ID, cmd.UpdatedAt.UnixMicro(), recipient.ID,
	)
	existing, found, err := findExistingMessageByClientMessageID(
		tx, conversation.ID, store.MessageSenderTypeApp, assistant.ID, clientMessageID,
	)
	if err != nil {
		return TaskNotificationResult{}, err
	}
	if found {
		return TaskNotificationResult{
			Created: false, Message: newMessage(existing), RecipientUserID: recipient.ID,
		}, nil
	}
	now := s.nowUTC()
	message := store.Message{
		ID: uuid.NewString(), ConversationID: conversation.ID, Seq: conversation.LastMessageSeq + 1,
		SenderType: store.MessageSenderTypeApp, SenderID: &assistant.ID, ClientMessageID: &clientMessageID,
		Body: body, Summary: summary, CreatedAt: now, UpdatedAt: now,
	}
	if err := tx.Create(&message).Error; err != nil {
		return TaskNotificationResult{}, err
	}
	if err := tx.Model(&store.Conversation{}).Where("id = ?", conversation.ID).Updates(map[string]any{
		"last_message_at": message.CreatedAt, "last_message_id": message.ID,
		"last_message_seq": message.Seq, "last_message_summary": message.Summary, "updated_at": now,
	}).Error; err != nil {
		return TaskNotificationResult{}, err
	}
	return TaskNotificationResult{
		Created: true, Message: newMessage(message), RecipientUserID: recipient.ID,
	}, nil
}

func taskNotificationRecipientIDs(cmd TaskNotificationCommand) []string {
	recipientIDs := make([]string, 0, 2)
	seen := make(map[string]struct{}, 2)
	for _, recipientID := range []*string{cmd.AssigneeUserID, &cmd.CreatedByUserID} {
		if recipientID == nil {
			continue
		}
		value := strings.TrimSpace(*recipientID)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		recipientIDs = append(recipientIDs, value)
	}
	return recipientIDs
}

func loadTaskNotificationAssigneeName(ctx context.Context, tx *gorm.DB, assigneeUserID *string) (string, error) {
	if assigneeUserID == nil {
		return "", nil
	}
	var assignee store.User
	err := tx.WithContext(ctx).Where("id = ? AND status = ?", *assigneeUserID, store.UserStatusActive).First(&assignee).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return taskNotificationUserDisplayName(assignee), nil
}

func taskNotificationUserDisplayName(user store.User) string {
	if nickname := strings.TrimSpace(user.Nickname); nickname != "" {
		return nickname
	}
	return strings.TrimSpace(user.Name)
}

func (s *Service) PublishTaskNotification(ctx context.Context, batch *TaskNotificationBatchResult) {
	if batch == nil {
		return
	}
	for index := range batch.Notifications {
		s.publishTaskNotificationResult(ctx, &batch.Notifications[index])
	}
}

func (s *Service) publishTaskNotificationResult(ctx context.Context, notification *TaskNotificationResult) {
	if notification == nil || !notification.Created || s.notifications == nil {
		return
	}
	s.notifications.PublishMessageCreated(ctx, []Delivery{{
		Message: notification.Message, UserID: notification.RecipientUserID,
	}})
}

func (s *Service) loadTaskNotificationAssistantApp(ctx context.Context, tx *gorm.DB) (store.App, error) {
	var assistant store.App
	err := tx.WithContext(ctx).First(&assistant, "id = ?", appregistry.AIAssistantAppID).Error
	if err == nil {
		return assistant, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return store.App{}, err
	}
	return appregistry.EnsureAIAssistantApp(tx.WithContext(ctx), s.apps)
}

func (s *Service) nowUTC() time.Time {
	return time.Now().UTC()
}
