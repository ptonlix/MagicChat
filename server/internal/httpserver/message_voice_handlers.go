package httpserver

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	fileapp "app/internal/application/file"
	"app/internal/store"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

const (
	maxVoiceMessageDurationMS   = 60_000
	maxVoiceMessageUploadBytes  = 1 * 1024 * 1024
	maxVoiceMessageRequestBytes = maxVoiceMessageUploadBytes + 512*1024
	messageTypeVoice            = "voice"
	voiceMessageContentType     = "audio/webm"
	voiceMessageDemoTranscript  = "这是一段语音消息的演示转写文字"
)

var webMHeader = []byte{0x1a, 0x45, 0xdf, 0xa3}

type voiceMessageBody struct {
	Type        string `json:"type"`
	FileID      string `json:"file_id"`
	DurationMS  int    `json:"duration_ms"`
	SizeBytes   int64  `json:"size_bytes"`
	ContentType string `json:"content_type"`
	Transcript  string `json:"transcript"`
}

// createConversationVoiceMessage godoc
//
// @Summary 发送语音消息
// @Description 普通用户上传最长 60 秒的 WebM/Opus 音频并发送为会话语音消息。音频写入 temporary bucket，消息 body 保存 file_id、时长、文件大小、内容类型和转写文字。
// @Tags 客户端消息
// @Accept multipart/form-data
// @Produce json
// @Param conversation_id path string true "会话 ID"
// @Param client_message_id formData string true "客户端消息 ID"
// @Param reply_to_message_id formData string false "引用消息 ID"
// @Param duration_ms formData int true "语音时长（毫秒，最大 60000）"
// @Param voice formData file true "WebM/Opus 语音文件"
// @Success 200 {object} successEnvelope{data=createMessageResponse}
// @Success 201 {object} successEnvelope{data=createMessageResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 403 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 413 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/conversations/{conversation_id}/messages/voices [post]
func (s *Server) createConversationVoiceMessage(c echo.Context) error {
	user, ok := currentUser(c)
	if !ok {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	conversationID, err := normalizeMessageConversationID(c.Param("conversation_id"))
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}
	c.Request().Body = http.MaxBytesReader(c.Response().Writer, c.Request().Body, maxVoiceMessageRequestBytes)
	if err := c.Request().ParseMultipartForm(maxVoiceMessageRequestBytes); err != nil {
		if isRequestBodyTooLarge(err) {
			return failure(c, http.StatusRequestEntityTooLarge, "request_too_large", "语音文件不能超过 1MiB")
		}
		return failure(c, http.StatusBadRequest, "invalid_request", "请求格式错误")
	}
	clientMessageID, err := normalizeClientMessageID(c.FormValue("client_message_id"))
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}
	replyToMessageID, err := normalizeOptionalMessageID(c.FormValue("reply_to_message_id"), "引用消息 ID")
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}
	existingMessage, exists, member, err := s.findExistingUserMessageBeforeFileUpload(user.ID, conversationID, clientMessageID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return failure(c, http.StatusNotFound, "not_found", "会话不存在")
		}
		if errors.Is(err, errConversationAccessDenied) {
			return failure(c, http.StatusForbidden, "forbidden", "无权访问会话")
		}
		if errors.Is(err, errConversationNotSendable) {
			return failure(c, http.StatusForbidden, "forbidden", "当前会话不能发送消息")
		}

		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	if exists {
		messageResponse, err := s.newMessageResponseForUser(c.Request().Context(), existingMessage, user.ID)
		if err != nil {
			return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
		}
		return success(c, http.StatusOK, createMessageResponse{Message: messageResponse})
	}
	if err := validateReplyToMessage(s.db, conversationID, member.HistoryVisibleFromSeq, replyToMessageID); err != nil {
		if errors.Is(err, errReplyToMessageInvalid) {
			return failure(c, http.StatusBadRequest, "invalid_request", "引用消息无效")
		}
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	durationMS, err := normalizeVoiceMessageDuration(c.FormValue("duration_ms"))
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}

	fileHeader, err := c.FormFile("voice")
	if err != nil {
		if isRequestBodyTooLarge(err) {
			return failure(c, http.StatusRequestEntityTooLarge, "request_too_large", "语音文件不能超过 1MiB")
		}
		return failure(c, http.StatusBadRequest, "invalid_request", "请选择要发送的语音")
	}
	if fileHeader.Size > maxVoiceMessageUploadBytes {
		return failure(c, http.StatusRequestEntityTooLarge, "request_too_large", "语音文件不能超过 1MiB")
	}
	if fileHeader.Size <= 0 {
		return failure(c, http.StatusBadRequest, "invalid_request", "语音文件不能为空")
	}
	contentType, _, err := mime.ParseMediaType(strings.TrimSpace(fileHeader.Header.Get("Content-Type")))
	if err != nil || !strings.EqualFold(contentType, voiceMessageContentType) {
		return failure(c, http.StatusBadRequest, "invalid_request", "语音文件必须是 WebM/Opus 格式")
	}

	file, err := fileHeader.Open()
	if err != nil {
		return failure(c, http.StatusBadRequest, "invalid_request", "读取语音文件失败")
	}
	defer file.Close()

	voiceBytes, err := readVoiceMessageUpload(file)
	if err != nil {
		if errors.Is(err, errVoiceMessageTooLarge) {
			return failure(c, http.StatusRequestEntityTooLarge, "request_too_large", "语音文件不能超过 1MiB")
		}
		return failure(c, http.StatusBadRequest, "invalid_request", err.Error())
	}

	temporaryFile, err := s.files.UploadTemporary(c.Request().Context(), fileapp.UploadTemporaryCommand{
		Content:     bytes.NewReader(voiceBytes),
		ContentType: voiceMessageContentType,
		SizeBytes:   int64(len(voiceBytes)),
	})
	if err != nil {
		if fileapp.ErrorCodeOf(err) == fileapp.CodeStorageUnavailable {
			return failure(c, http.StatusInternalServerError, "internal_error", "临时文件存储未配置")
		}
		return failure(c, http.StatusInternalServerError, "internal_error", fileapp.ErrorMessage(err))
	}

	body, err := json.Marshal(voiceMessageBody{
		Type:        messageTypeVoice,
		FileID:      temporaryFile.ID,
		DurationMS:  durationMS,
		SizeBytes:   temporaryFile.SizeBytes,
		ContentType: voiceMessageContentType,
		Transcript:  voiceMessageDemoTranscript,
	})
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	message, created, _, _, err := s.createUserMessageWithMetadata(
		c.Request().Context(),
		user.ID,
		conversationID,
		clientMessageID,
		body,
		staticMessageBodyFinalizer(voiceMessageSummary(durationMS, voiceMessageDemoTranscript)),
		createMessageMetadata{
			ReplyToMessageID: replyToMessageID,
			EmitAppEvent:     true,
			AfterCommitBeforeAppDelivery: func(message store.Message, memberUserIDs []string, mentionedUserIDs []string) {
				s.sendRealtimeMessageCreatedToUsers(c.Request().Context(), memberUserIDs, message)
				s.sendRealtimeConversationMemberMentionedToUsers(mentionedUserIDs, message)
			},
		},
	)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return failure(c, http.StatusNotFound, "not_found", "会话不存在")
		}
		if errors.Is(err, errConversationAccessDenied) {
			return failure(c, http.StatusForbidden, "forbidden", "无权访问会话")
		}
		if errors.Is(err, errConversationNotSendable) {
			return failure(c, http.StatusForbidden, "forbidden", "当前会话不能发送消息")
		}
		if errors.Is(err, errReplyToMessageInvalid) {
			return failure(c, http.StatusBadRequest, "invalid_request", "引用消息无效")
		}

		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	messageResponse, err := s.newMessageResponseForUser(c.Request().Context(), message, user.ID)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}

	return success(c, status, createMessageResponse{Message: messageResponse})
}

var errVoiceMessageTooLarge = errors.New("voice message too large")

func normalizeVoiceMessageDuration(rawDurationMS string) (int, error) {
	durationMS, err := strconv.Atoi(strings.TrimSpace(rawDurationMS))
	if err != nil || durationMS <= 0 {
		return 0, errors.New("语音时长必须是正整数")
	}
	if durationMS > maxVoiceMessageDurationMS {
		return 0, errors.New("语音时长不能超过 60 秒")
	}

	return durationMS, nil
}

func readVoiceMessageUpload(reader io.Reader) ([]byte, error) {
	content, err := io.ReadAll(io.LimitReader(reader, maxVoiceMessageUploadBytes+1))
	if err != nil {
		return nil, errors.New("读取语音文件失败")
	}
	if len(content) > maxVoiceMessageUploadBytes {
		return nil, errVoiceMessageTooLarge
	}
	if len(content) == 0 {
		return nil, errors.New("语音文件不能为空")
	}
	if !bytes.HasPrefix(content, webMHeader) || !bytes.Contains(content, []byte("webm")) || !bytes.Contains(content, []byte("OpusHead")) {
		return nil, errors.New("语音文件必须是 WebM/Opus 格式")
	}

	return content, nil
}

func voiceMessageSummary(durationMS int, transcript string) string {
	totalSeconds := (durationMS + 999) / 1000
	summary := fmt.Sprintf("[语音] %02d:%02d", totalSeconds/60, totalSeconds%60)
	transcript = strings.TrimSpace(transcript)
	if transcript == "" {
		return summary
	}

	return summary + " - " + transcript
}
