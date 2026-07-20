package conversation

import (
	"context"
	"errors"

	"app/internal/application/conversationaccess"
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
		access, err := conversationaccess.Load(tx, conversationID, false)
		if err != nil {
			return err
		}
		if access.Conversation.Status != store.ConversationStatusActive ||
			(access.ParentConversation != nil && access.ParentConversation.Status != store.ConversationStatusActive) {
			return ErrAccessDenied
		}
		member, err := conversationaccess.RequireUserMember(tx, access, accountID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrAccessDenied
			}
			return err
		}
		if !conversationaccess.TopicSourceVisibleToMember(access, member) {
			return ErrAccessDenied
		}
		if access.IsTopic() {
			if _, err := conversationaccess.TopicParticipant(
				tx, conversationID, store.ConversationMemberTypeUser, accountID,
			); err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return ErrAccessDenied
				}
				return err
			}
		}
		if conversationID == builtinAssistantConversationID(accountID) {
			if !cmd.Pinned {
				return ErrBuiltinAssistantPin
			}
			return nil
		}

		if cmd.Pinned {
			result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&store.ConversationPin{
				UserID: accountID, ConversationID: conversationID, CreatedAt: s.now().UTC(),
			})
			if result.Error != nil {
				return result.Error
			}
			changed = result.RowsAffected > 0
			return nil
		}
		result := tx.Where("user_id = ? AND conversation_id = ?", accountID, conversationID).
			Delete(&store.ConversationPin{})
		if result.Error != nil {
			return result.Error
		}
		changed = result.RowsAffected > 0
		return nil
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
