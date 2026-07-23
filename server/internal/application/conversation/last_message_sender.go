package conversation

import (
	"strings"

	"app/internal/store"

	"gorm.io/gorm"
)

type lastMessageSenderReference struct {
	ID         string
	SenderID   *string
	SenderType string
}

func loadLastMessageSenders(db *gorm.DB, conversations []store.Conversation) (map[string]*LastMessageSender, error) {
	result := make(map[string]*LastMessageSender, len(conversations))
	conversationByMessageID := make(map[string]string, len(conversations))
	messageIDs := make([]string, 0, len(conversations))
	for _, conversation := range conversations {
		if conversation.LastMessageID == nil || strings.TrimSpace(*conversation.LastMessageID) == "" {
			continue
		}
		messageID := *conversation.LastMessageID
		conversationByMessageID[messageID] = conversation.ID
		messageIDs = append(messageIDs, messageID)
	}
	if len(messageIDs) == 0 {
		return result, nil
	}

	model := any(&store.Message{})
	if store.MessagePartitioningEnabled(db) {
		model = &store.MessageRegistry{}
	}
	var references []lastMessageSenderReference
	if err := db.Model(model).Select("id", "sender_id", "sender_type").Where("id IN ?", messageIDs).Find(&references).Error; err != nil {
		return nil, err
	}

	userSet := make(map[string]struct{})
	appSet := make(map[string]struct{})
	for _, reference := range references {
		if reference.SenderID == nil {
			continue
		}
		switch reference.SenderType {
		case store.MessageSenderTypeUser:
			userSet[*reference.SenderID] = struct{}{}
		case store.MessageSenderTypeApp:
			appSet[*reference.SenderID] = struct{}{}
		}
	}

	usersByID := make(map[string]store.User, len(userSet))
	if userIDs := sortedKeys(userSet); len(userIDs) > 0 {
		var users []store.User
		if err := db.Select("id", "name", "nickname").Where("id IN ?", userIDs).Find(&users).Error; err != nil {
			return nil, err
		}
		for _, user := range users {
			usersByID[user.ID] = user
		}
	}
	appsByID := make(map[string]store.App, len(appSet))
	if appIDs := sortedKeys(appSet); len(appIDs) > 0 {
		var apps []store.App
		if err := db.Unscoped().Select("id", "name").Where("id IN ?", appIDs).Find(&apps).Error; err != nil {
			return nil, err
		}
		for _, app := range apps {
			appsByID[app.ID] = app
		}
	}

	for _, reference := range references {
		conversationID, ok := conversationByMessageID[reference.ID]
		if !ok {
			continue
		}
		sender := &LastMessageSender{Type: reference.SenderType}
		if reference.SenderID != nil {
			sender.ID = *reference.SenderID
		}
		switch reference.SenderType {
		case store.MessageSenderTypeUser:
			if user, exists := usersByID[sender.ID]; exists {
				sender.Name = user.Name
				sender.Nickname = user.Nickname
			}
		case store.MessageSenderTypeApp:
			if app, exists := appsByID[sender.ID]; exists {
				sender.Name = app.Name
			}
		case store.MessageSenderTypeSystem:
			sender.Name = "系统"
		default:
			continue
		}
		result[conversationID] = sender
	}
	return result, nil
}
