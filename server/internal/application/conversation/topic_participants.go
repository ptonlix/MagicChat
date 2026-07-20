package conversation

import (
	"app/internal/store"

	"gorm.io/gorm"
)

func removeParentMemberTopicParticipations(db *gorm.DB, parentConversationID, participantType, participantID string) ([]string, error) {
	topicIDs := make([]string, 0)
	if err := db.Model(&store.ConversationTopicParticipant{}).
		Select("conversation_topic_participants.conversation_id").
		Joins("JOIN conversation_topics ct ON ct.conversation_id = conversation_topic_participants.conversation_id").
		Where("ct.parent_conversation_id = ?", parentConversationID).
		Where("conversation_topic_participants.participant_type = ? AND conversation_topic_participants.participant_id = ?", participantType, participantID).
		Order("conversation_topic_participants.conversation_id ASC").
		Pluck("conversation_topic_participants.conversation_id", &topicIDs).Error; err != nil {
		return nil, err
	}
	if len(topicIDs) == 0 {
		return topicIDs, nil
	}
	if err := db.Where(
		"conversation_id IN ? AND participant_type = ? AND participant_id = ?",
		topicIDs, participantType, participantID,
	).Delete(&store.ConversationTopicParticipant{}).Error; err != nil {
		return nil, err
	}
	return topicIDs, nil
}
