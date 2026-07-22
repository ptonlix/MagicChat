package conversation

import (
	"context"
	"errors"
	"time"

	"app/internal/application/conversationaccess"
	"app/internal/store"

	"gorm.io/gorm"
)

func (s *Service) MarkRead(ctx context.Context, cmd ReadCommand) (ReadResult, error) {
	conversationID, err := normalizeConversationID(cmd.ConversationID)
	if err != nil {
		return ReadResult{}, invalidRequest(err.Error(), err)
	}
	if cmd.UpToSeq != nil && *cmd.UpToSeq <= 0 {
		return ReadResult{}, invalidRequest("up_to_seq 必须是正整数", nil)
	}
	result, err := s.markRead(s.db, cmd.AccountID, conversationID, cmd.UpToSeq)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ReadResult{}, notFound("会话不存在", err)
	}
	if errors.Is(err, ErrAccessDenied) {
		return ReadResult{}, forbidden("无权访问会话", err)
	}
	if err != nil {
		return ReadResult{}, internalError(err)
	}
	return result, nil
}

func (s *Service) markRead(db *gorm.DB, userID, conversationID string, upToSeq *int64) (ReadResult, error) {
	var response ReadResult
	err := db.Transaction(func(tx *gorm.DB) error {
		var err error
		response, err = markReadTransaction(tx, userID, conversationID, upToSeq)
		return err
	})
	return response, err
}

func markReadTransaction(tx *gorm.DB, userID, conversationID string, upToSeq *int64) (ReadResult, error) {
	access, err := conversationaccess.Load(tx, conversationID, true)
	if err != nil {
		return ReadResult{}, err
	}
	conversation := access.Conversation
	if conversation.Status != store.ConversationStatusActive {
		return ReadResult{}, ErrAccessDenied
	}
	member, err := conversationaccess.RequireUserMember(tx, access, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ReadResult{}, ErrAccessDenied
		}
		return ReadResult{}, err
	}
	if !conversationaccess.TopicSourceVisibleToMember(access, member) {
		return ReadResult{}, ErrAccessDenied
	}
	if access.ParentConversation != nil && access.ParentConversation.Status != store.ConversationStatusActive {
		return ReadResult{}, ErrAccessDenied
	}
	targetSeq := conversation.LastMessageSeq
	if upToSeq != nil && *upToSeq < targetSeq {
		targetSeq = *upToSeq
	}
	if access.IsTopic() {
		participant, err := conversationaccess.TopicParticipant(tx, conversationID, store.ConversationMemberTypeUser, userID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ReadResult{}, ErrAccessDenied
			}
			return ReadResult{}, err
		}
		var targetMessageID *string
		if targetSeq == conversation.LastMessageSeq {
			targetMessageID = conversation.LastMessageID
		}
		if err := conversationaccess.AdvanceTopicParticipantReadSeq(tx, conversationID, store.ConversationMemberTypeUser, userID, targetSeq, targetMessageID, time.Now().UTC()); err != nil {
			return ReadResult{}, err
		}
		member.LastReadSeq = participant.LastReadSeq
	} else if err := advanceReadSeq(tx, conversationID, userID, targetSeq); err != nil {
		return ReadResult{}, err
	}
	if targetSeq > member.LastReadSeq {
		member.LastReadSeq = targetSeq
	}
	return ReadResult{
		ConversationID: conversationID, LastReadSeq: member.LastReadSeq,
		UnreadCount: unreadCount(conversation.LastMessageSeq, member.LastReadSeq),
	}, nil
}
