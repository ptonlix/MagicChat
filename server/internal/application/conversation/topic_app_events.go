package conversation

import (
	"encoding/json"
	"time"

	appapp "app/internal/application/app"
	"app/internal/application/conversationaccess"
	"app/internal/store"

	"gorm.io/gorm"
)

const appEventTopicClosed = "topic.closed"

type topicClosedAppEventPayload struct {
	Archived             bool   `json:"archived"`
	ConversationID       string `json:"conversation_id"`
	ParentConversationID string `json:"parent_conversation_id"`
	SourceMessageID      string `json:"source_message_id"`
}

func createTopicClosedAppEventOutbox(db *gorm.DB, access conversationaccess.Context, now time.Time) ([]AppEvent, error) {
	appIDs, err := conversationaccess.ActiveTopicParticipantIDs(db, access, store.ConversationMemberTypeApp)
	if err != nil || len(appIDs) == 0 {
		return nil, err
	}
	apps, err := appapp.LockUsableApps(db, appIDs)
	if err != nil {
		return nil, err
	}
	activeAppIDs, err := conversationaccess.ActiveTopicParticipantIDs(db, access, store.ConversationMemberTypeApp)
	if err != nil {
		return nil, err
	}
	activeApps := make(map[string]struct{}, len(activeAppIDs))
	for _, appID := range activeAppIDs {
		activeApps[appID] = struct{}{}
	}
	payload, err := json.Marshal(topicClosedAppEventPayload{
		Archived: true, ConversationID: access.Conversation.ID,
		ParentConversationID: access.Topic.ParentConversationID,
		SourceMessageID:      access.Topic.SourceMessageID,
	})
	if err != nil {
		return nil, err
	}
	events := make([]AppEvent, 0, len(apps))
	for _, app := range apps {
		if _, ok := activeApps[app.ID]; !ok {
			continue
		}
		stored := store.AppEventOutbox{
			AppID: app.ID, Event: appEventTopicClosed, Payload: payload, CreatedAt: now,
		}
		if err := db.Create(&stored).Error; err != nil {
			return nil, err
		}
		events = append(events, AppEvent{
			AppID: stored.AppID, Cursor: stored.ID, Event: stored.Event, Payload: stored.Payload,
		})
	}
	return events, nil
}
