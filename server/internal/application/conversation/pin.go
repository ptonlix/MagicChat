package conversation

import (
	"context"
	"errors"

	"app/internal/store"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *Service) SetPinned(ctx context.Context, cmd SetPinCommand) (SetPinResult, error) {
	accountID, err := normalizeUUID(cmd.AccountID, "当前用户 ID 格式错误")
	if err != nil {
		return SetPinResult{}, invalidRequest(err.Error(), err)
	}
	conversationID, err := normalizeConversationID(cmd.ConversationID)
	if err != nil {
		return SetPinResult{}, invalidRequest(err.Error(), err)
	}

	changed := false
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, err := requireConversationPreferenceAccess(tx, conversationID, accountID); err != nil {
			return err
		}
		if conversationID == builtinAssistantConversationID(accountID) {
			if !cmd.Pinned {
				return ErrBuiltinAssistantPin
			}
			return nil
		}

		var current store.ConversationUserPreference
		query := tx.First(&current, "user_id = ? AND conversation_id = ?", accountID, conversationID)
		if query.Error != nil && !errors.Is(query.Error, gorm.ErrRecordNotFound) {
			return query.Error
		}
		changed = current.Pinned != cmd.Pinned
		if !changed {
			return nil
		}
		now := s.now().UTC()
		preference := store.ConversationUserPreference{
			UserID: accountID, ConversationID: conversationID, Pinned: cmd.Pinned,
			CreatedAt: now, UpdatedAt: now,
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}, {Name: "conversation_id"}},
			DoUpdates: clause.Assignments(map[string]any{"pinned": cmd.Pinned, "updated_at": now}),
		}).Create(&preference).Error; err != nil {
			return err
		}
		return deleteEmptyConversationPreference(tx, accountID, conversationID)
	})
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			return SetPinResult{}, notFound("会话不存在", err)
		case errors.Is(err, ErrAccessDenied):
			return SetPinResult{}, forbidden("无权访问会话", err)
		case errors.Is(err, ErrBuiltinAssistantPin):
			return SetPinResult{}, conflict("茉莉为默认置顶会话，不能取消置顶", err)
		default:
			return SetPinResult{}, internalError(err)
		}
	}
	result := SetPinResult{ConversationID: conversationID, Pinned: cmd.Pinned}
	if changed && s.notifications != nil {
		s.notifications.PublishConversationPinUpdated(ctx, []string{accountID}, ConversationPinEvent{
			ConversationID: conversationID, Pinned: cmd.Pinned,
		})
	}
	return result, nil
}
