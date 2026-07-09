package httpserver

import (
	"encoding/json"
	"errors"
	"time"

	"app/internal/realtime"
	"app/internal/store"

	"gorm.io/gorm"
)

type appMessageCreatedPayload struct {
	Conversation appMessageConversationPayload `json:"conversation"`
	Message      appMessagePayload             `json:"message"`
	Sender       appMessageSenderPayload       `json:"sender"`
}

type appMessageConversationPayload struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

type appMessagePayload struct {
	Body        json.RawMessage          `json:"body"`
	CreatedAt   time.Time                `json:"created_at"`
	DelegatedBy *appMessageSenderPayload `json:"delegated_by,omitempty"`
	ID          string                   `json:"id"`
	Seq         int64                    `json:"seq"`
	Sender      *appMessageSenderPayload `json:"sender,omitempty"`
	Summary     string                   `json:"summary"`
}

type appMessageSenderPayload struct {
	Email    string `json:"email,omitempty"`
	ID       string `json:"id"`
	Name     string `json:"name"`
	Nickname string `json:"nickname"`
	Type     string `json:"type"`
}

func (s *Server) dispatchAppMessageCreatedEvent(sender store.User, message store.Message) error {
	if s.appConnections == nil {
		return nil
	}

	conversation, err := s.findMessageConversation(message.ConversationID)
	if err != nil {
		return err
	}

	switch conversation.Kind {
	case store.ConversationKindApp:
		appID, ok, err := s.findMessageConversationAppID(message.ConversationID)
		if err != nil || !ok {
			return err
		}
		s.sendAppMessageCreatedEvent(appID, conversation, sender, message)
	case store.ConversationKindGroup:
		appIDs, err := s.findMentionedGroupAppIDs(conversation.ID, message.Body)
		if err != nil {
			return err
		}
		for _, appID := range appIDs {
			s.sendAppMessageCreatedEvent(appID, conversation, sender, message)
		}
	}

	return nil
}

func (s *Server) sendAppMessageCreatedEvent(appID string, conversation store.Conversation, sender store.User, message store.Message) {
	s.appConnections.SendToApp(appID, realtime.NewEvent(realtime.EventMessageCreated, appMessageCreatedPayload{
		Conversation: appMessageConversationPayload{
			ID:   conversation.ID,
			Name: conversation.Name,
			Type: conversation.Kind,
		},
		Message: appMessagePayload{
			Body:      message.Body,
			CreatedAt: message.CreatedAt,
			ID:        message.ID,
			Seq:       message.Seq,
			Summary:   message.Summary,
		},
		Sender: appMessageSenderPayload{
			Email:    sender.Email,
			ID:       sender.ID,
			Name:     sender.Name,
			Nickname: sender.Nickname,
			Type:     store.MessageSenderTypeUser,
		},
	}))
}

func (s *Server) findMessageConversation(conversationID string) (store.Conversation, error) {
	var conversation store.Conversation
	if err := s.db.First(&conversation, "id = ?", conversationID).Error; err != nil {
		return store.Conversation{}, err
	}

	return conversation, nil
}

func (s *Server) findMentionedGroupAppIDs(conversationID string, body json.RawMessage) ([]string, error) {
	targets := parseMessageMentionTargets(body)
	if len(targets) == 0 {
		return nil, nil
	}

	targetSet := make(map[string]struct{}, len(targets))
	targetIDs := make([]string, 0, len(targets))
	for _, target := range targets {
		if target.All || target.MemberType != store.ConversationMemberTypeApp {
			continue
		}
		if _, ok := targetSet[target.MemberID]; ok {
			continue
		}
		targetSet[target.MemberID] = struct{}{}
		targetIDs = append(targetIDs, target.MemberID)
	}
	if len(targetIDs) == 0 {
		return nil, nil
	}

	var members []store.ConversationMember
	if err := s.db.
		Where(
			"conversation_id = ? AND member_type = ? AND member_id IN ? AND left_at IS NULL",
			conversationID,
			store.ConversationMemberTypeApp,
			targetIDs,
		).
		Find(&members).Error; err != nil {
		return nil, err
	}

	memberSet := make(map[string]struct{}, len(members))
	for _, member := range members {
		memberSet[member.MemberID] = struct{}{}
	}

	appIDs := make([]string, 0, len(targetIDs))
	for _, targetID := range targetIDs {
		if _, ok := memberSet[targetID]; ok {
			appIDs = append(appIDs, targetID)
		}
	}

	return appIDs, nil
}

func (s *Server) findMessageConversationAppID(conversationID string) (string, bool, error) {
	var member store.ConversationMember
	err := s.db.First(
		&member,
		"conversation_id = ? AND member_type = ? AND left_at IS NULL",
		conversationID,
		store.ConversationMemberTypeApp,
	).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}

	return member.MemberID, true, nil
}
