package httpserver

import (
	"context"
	"log/slog"

	messageapp "app/internal/application/message"
	"app/internal/store"
)

func (s *Server) loadNotificationMutedTargets(ctx context.Context, conversationID string, userIDs []string) map[string]bool {
	result := make(map[string]bool)
	if conversationID == "" || len(userIDs) == 0 {
		return result
	}
	var preferences []store.ConversationUserPreference
	if err := s.db.WithContext(ctx).
		Select("user_id", "notification_muted").
		Where("conversation_id = ? AND user_id IN ? AND notification_muted = ?", conversationID, userIDs, true).
		Find(&preferences).Error; err != nil {
		slog.Error("load conversation notification preferences", "conversation_id", conversationID, "user_count", len(userIDs), "error", err)
		for _, userID := range userIDs {
			result[userID] = true
		}
		return result
	}
	for _, preference := range preferences {
		result[preference.UserID] = true
	}
	return result
}

func (s *Server) loadDeliveryNotificationMutedTargets(ctx context.Context, deliveries []messageapp.Delivery) map[string]bool {
	result := make(map[string]bool)
	if len(deliveries) == 0 {
		return result
	}
	conversationIDs := make([]string, 0, len(deliveries))
	userIDs := make([]string, 0, len(deliveries))
	for _, delivery := range deliveries {
		conversationIDs = append(conversationIDs, delivery.Message.ConversationID)
		userIDs = append(userIDs, delivery.UserID)
	}
	var preferences []store.ConversationUserPreference
	if err := s.db.WithContext(ctx).
		Select("user_id", "conversation_id", "notification_muted").
		Where("conversation_id IN ? AND user_id IN ? AND notification_muted = ?", conversationIDs, userIDs, true).
		Find(&preferences).Error; err != nil {
		slog.Error("load message delivery notification preferences", "delivery_count", len(deliveries), "error", err)
		for _, delivery := range deliveries {
			result[notificationTargetKey(delivery.Message.ConversationID, delivery.UserID)] = true
		}
		return result
	}
	for _, preference := range preferences {
		result[notificationTargetKey(preference.ConversationID, preference.UserID)] = true
	}
	return result
}

func notificationTargetKey(conversationID, userID string) string {
	return conversationID + "\x00" + userID
}
