package httpserver

import (
	"net/http"
	"sort"
	"strings"

	"app/internal/appregistry"
	"app/internal/store"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type contactAppResponse struct {
	Avatar      string `json:"avatar" example:"/assets/apps/assistant.webp"`
	Description string `json:"description" example:"AI 助手"`
	ID          string `json:"id" example:"7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"`
	Name        string `json:"name" example:"AI 女菩萨"`
	Online      bool   `json:"online" example:"false"`
	Type        string `json:"type" example:"app"`
}

type contactGroupResponse struct {
	Avatar        string                             `json:"avatar" example:"/assets/avatars/groups/07.webp"`
	AvatarMembers []contactGroupAvatarMemberResponse `json:"avatar_members,omitempty"`
	ID            string                             `json:"id" example:"7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"`
	Joined        bool                               `json:"joined" example:"false"`
	MemberCount   int                                `json:"member_count" example:"8"`
	Name          string                             `json:"name" example:"IM探索"`
	Type          string                             `json:"type" example:"group"`
	Visibility    string                             `json:"visibility" example:"public"`
}

type contactGroupAvatarMemberResponse struct {
	Avatar   string `json:"avatar"`
	Name     string `json:"name"`
	Nickname string `json:"nickname"`
	Role     string `json:"role"`
}

type contactUserResponse struct {
	Avatar       string  `json:"avatar" example:"/assets/avatars/builtin/07.webp"`
	Email        string  `json:"email" example:"user@example.com"`
	ID           string  `json:"id" example:"7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"`
	LastOnlineAt *string `json:"last_online_at" example:"2026-07-03T01:00:00Z"`
	Name         string  `json:"name" example:"张三"`
	Nickname     string  `json:"nickname" example:"小张"`
	Online       bool    `json:"online" example:"true"`
	Phone        string  `json:"phone" example:"+8613812345678"`
	Type         string  `json:"type" example:"user"`
}

type listClientContactsResponse struct {
	Apps   []contactAppResponse   `json:"apps"`
	Groups []contactGroupResponse `json:"groups"`
	Users  []contactUserResponse  `json:"users"`
}

type listContactUsersResponse struct {
	Contacts []contactUserResponse `json:"contacts"`
}

// listClientContacts godoc
//
// @Summary 列出通讯录
// @Description 普通用户获取统一通讯录。返回对当前用户可见的应用、启用用户，以及当前用户已加入或公开的 active 群组。
// @Tags 客户端通讯录
// @Produce json
// @Success 200 {object} successEnvelope{data=listClientContactsResponse}
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/contacts [get]
func (s *Server) listClientContacts(c echo.Context) error {
	user, ok := currentUser(c)
	if !ok {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	if _, err := appregistry.EnsureAIAssistantApp(s.db, s.cfg.Apps); err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	keyword := strings.ToLower(strings.TrimSpace(c.QueryParam("keyword")))
	users, err := s.loadContactUsers(keyword)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	apps, err := s.loadContactApps(user.ID, keyword)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	groups, err := s.loadContactGroups(user.ID, keyword)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}
	return success(c, http.StatusOK, listClientContactsResponse{
		Apps:   apps,
		Groups: groups,
		Users:  users,
	})
}

// listContactUsers godoc
//
// @Summary 列出通讯录用户
// @Description 普通用户获取通讯录。返回所有启用用户，包含当前用户；keyword 会搜索名称、昵称、邮箱和手机号。
// @Tags 客户端通讯录
// @Produce json
// @Param keyword query string false "搜索关键字，匹配名称、昵称、邮箱或手机号"
// @Success 200 {object} successEnvelope{data=listContactUsersResponse}
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Router /api/client/contacts/users [get]
func (s *Server) listContactUsers(c echo.Context) error {
	keyword := strings.ToLower(strings.TrimSpace(c.QueryParam("keyword")))
	contacts, err := s.loadContactUsers(keyword)
	if err != nil {
		return failure(c, http.StatusInternalServerError, "internal_error", "服务端错误")
	}

	return success(c, http.StatusOK, listContactUsersResponse{
		Contacts: contacts,
	})
}

func (s *Server) loadContactUsers(keyword string) ([]contactUserResponse, error) {
	query := s.db.Model(&store.User{}).Where("status = ?", store.UserStatusActive)
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("LOWER(email) LIKE ? OR LOWER(name) LIKE ? OR LOWER(nickname) LIKE ? OR phone LIKE ?", like, like, like, like)
	}

	var users []store.User
	if err := query.Order("name ASC").Order("email ASC").Order("id ASC").Find(&users).Error; err != nil {
		return nil, err
	}

	contacts := make([]contactUserResponse, 0, len(users))
	userIDs := make([]string, 0, len(users))
	for _, user := range users {
		userIDs = append(userIDs, user.ID)
	}
	onlineStatus := s.realtime.OnlineStatus(userIDs)
	for _, user := range users {
		contacts = append(contacts, newContactUserResponse(user, onlineStatus[user.ID]))
	}

	return contacts, nil
}

func (s *Server) loadContactApps(currentUserID string, keyword string) ([]contactAppResponse, error) {
	return s.loadContactAppsForIdentity(store.MessageSenderTypeUser, currentUserID, keyword)
}

func (s *Server) loadContactAppsForIdentity(identityType string, identityID string, keyword string) ([]contactAppResponse, error) {
	query := s.db.Model(&store.App{}).Where("enabled = ?", true)
	switch identityType {
	case store.MessageSenderTypeApp:
		query = query.Where("visibility = ? OR id = ?", store.AppVisibilityPublic, identityID)
	default:
		query = query.Where(
			"visibility = ? OR (visibility = ? AND creator_user_id = ?)",
			store.AppVisibilityPublic,
			store.AppVisibilityCreator,
			identityID,
		)
	}
	if keyword != "" {
		query = query.Where("LOWER(name) LIKE ? OR LOWER(description) LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	var apps []store.App
	if err := query.Order("LOWER(name) ASC").Order("id ASC").Find(&apps).Error; err != nil {
		return nil, err
	}

	responses := make([]contactAppResponse, 0, len(apps))
	for _, app := range apps {
		responses = append(responses, s.newContactAppResponse(app))
	}

	return responses, nil
}

func (s *Server) loadContactGroups(currentUserID string, keyword string) ([]contactGroupResponse, error) {
	return s.loadContactGroupsForIdentity(store.MessageSenderTypeUser, currentUserID, keyword)
}

func (s *Server) loadContactGroupsForIdentity(identityType string, identityID string, keyword string) ([]contactGroupResponse, error) {
	memberType := store.ConversationMemberTypeUser
	if identityType == store.MessageSenderTypeApp {
		memberType = store.ConversationMemberTypeApp
	}
	memberExistsSQL := "EXISTS (SELECT 1 FROM conversation_members cm WHERE cm.conversation_id = conversations.id AND cm.member_type = ? AND cm.member_id = ? AND cm.left_at IS NULL)"
	query := s.db.Model(&store.Conversation{}).
		Where("kind = ? AND status = ?", store.ConversationKindGroup, store.ConversationStatusActive).
		Where(
			"(visibility = ? OR "+memberExistsSQL+")",
			store.ConversationVisibilityPublic,
			memberType,
			identityID,
		)
	if keyword != "" {
		query = query.Where("LOWER(name) LIKE ?", "%"+keyword+"%")
	}

	var groups []store.Conversation
	if err := query.
		Order(gorm.Expr("CASE WHEN "+memberExistsSQL+" THEN 0 ELSE 1 END", memberType, identityID)).
		Order("LOWER(name) ASC").
		Order("id ASC").
		Find(&groups).Error; err != nil {
		return nil, err
	}

	groupIDs := make([]string, 0, len(groups))
	for _, group := range groups {
		groupIDs = append(groupIDs, group.ID)
	}
	memberCounts, joinedGroupIDs, err := s.loadContactGroupMembership(identityType, identityID, groupIDs)
	if err != nil {
		return nil, err
	}
	joinedGroupIDList := make([]string, 0, len(joinedGroupIDs))
	for _, group := range groups {
		if joinedGroupIDs[group.ID] {
			joinedGroupIDList = append(joinedGroupIDList, group.ID)
		}
	}
	avatarMembersByGroupID, err := s.loadContactGroupAvatarMembers(joinedGroupIDList)
	if err != nil {
		return nil, err
	}

	responses := make([]contactGroupResponse, 0, len(groups))
	for _, group := range groups {
		joined := joinedGroupIDs[group.ID]
		avatarMembers := avatarMembersByGroupID[group.ID]
		responses = append(responses, newContactGroupResponse(group, memberCounts[group.ID], joined, avatarMembers))
	}

	return responses, nil
}

func (s *Server) loadContactGroupAvatarMembers(groupIDs []string) (map[string][]contactGroupAvatarMemberResponse, error) {
	responsesByGroupID := make(map[string][]contactGroupAvatarMemberResponse, len(groupIDs))
	if len(groupIDs) == 0 {
		return responsesByGroupID, nil
	}

	rankedMembers := s.db.Model(&store.ConversationMember{}).
		Select(`conversation_members.*, ROW_NUMBER() OVER (
			PARTITION BY conversation_id
			ORDER BY CASE role WHEN ? THEN 0 WHEN ? THEN 1 ELSE 2 END,
			joined_at ASC, member_type ASC, member_id ASC
		) AS avatar_rank`, store.ConversationMemberRoleOwner, store.ConversationMemberRoleAdmin).
		Where("conversation_id IN ? AND left_at IS NULL", groupIDs)
	var members []store.ConversationMember
	if err := s.db.
		Table("(?) AS ranked_members", rankedMembers).
		Where("avatar_rank <= 4").
		Order("conversation_id ASC").
		Order("avatar_rank ASC").
		Scan(&members).Error; err != nil {
		return nil, err
	}

	usersByID, appsByID, err := s.loadConversationMemberIdentities(members)
	if err != nil {
		return nil, err
	}
	membersByGroupID := make(map[string][]store.ConversationMember, len(groupIDs))
	for _, member := range members {
		membersByGroupID[member.ConversationID] = append(membersByGroupID[member.ConversationID], member)
	}
	for groupID, groupMembers := range membersByGroupID {
		memberResponses := newConversationMemberResponses(groupMembers, usersByID, appsByID)
		responsesByGroupID[groupID] = newContactGroupAvatarMemberResponses(memberResponses)
	}
	return responsesByGroupID, nil
}

func (s *Server) loadContactGroupMembership(identityType string, identityID string, groupIDs []string) (map[string]int, map[string]bool, error) {
	memberCounts := make(map[string]int, len(groupIDs))
	joinedGroupIDs := make(map[string]bool, len(groupIDs))
	if len(groupIDs) == 0 {
		return memberCounts, joinedGroupIDs, nil
	}

	type countRow struct {
		ConversationID string
		Count          int
	}
	var counts []countRow
	if err := s.db.Model(&store.ConversationMember{}).
		Select("conversation_id, COUNT(*) AS count").
		Where("conversation_id IN ? AND member_type = ? AND left_at IS NULL", groupIDs, store.ConversationMemberTypeUser).
		Group("conversation_id").
		Scan(&counts).Error; err != nil {
		return nil, nil, err
	}
	for _, count := range counts {
		memberCounts[count.ConversationID] = count.Count
	}

	var joinedMembers []store.ConversationMember
	memberType := store.ConversationMemberTypeUser
	if identityType == store.MessageSenderTypeApp {
		memberType = store.ConversationMemberTypeApp
	}
	if err := s.db.
		Where("conversation_id IN ? AND member_type = ? AND member_id = ? AND left_at IS NULL", groupIDs, memberType, identityID).
		Find(&joinedMembers).Error; err != nil {
		return nil, nil, err
	}
	for _, member := range joinedMembers {
		joinedGroupIDs[member.ConversationID] = true
	}

	return memberCounts, joinedGroupIDs, nil
}

func (s *Server) newContactAppResponse(app store.App) contactAppResponse {
	return contactAppResponse{
		Avatar:      app.Avatar,
		Description: app.Description,
		ID:          app.ID,
		Name:        app.Name,
		Online:      s.appConnections != nil && s.appConnections.IsOnline(app.ID),
		Type:        "app",
	}
}

func newContactGroupResponse(group store.Conversation, memberCount int, joined bool, avatarMembers []contactGroupAvatarMemberResponse) contactGroupResponse {
	return contactGroupResponse{
		Avatar:        group.Avatar,
		AvatarMembers: avatarMembers,
		ID:            group.ID,
		Joined:        joined,
		MemberCount:   memberCount,
		Name:          group.Name,
		Type:          "group",
		Visibility:    group.Visibility,
	}
}

func newContactGroupAvatarMemberResponses(members []conversationMemberResponse) []contactGroupAvatarMemberResponse {
	ordered := append([]conversationMemberResponse(nil), members...)
	sort.SliceStable(ordered, func(left int, right int) bool {
		return contactGroupAvatarMemberRoleRank(ordered[left].Role) < contactGroupAvatarMemberRoleRank(ordered[right].Role)
	})
	if len(ordered) > 4 {
		ordered = ordered[:4]
	}

	responses := make([]contactGroupAvatarMemberResponse, 0, len(ordered))
	for _, member := range ordered {
		responses = append(responses, contactGroupAvatarMemberResponse{
			Avatar:   member.Avatar,
			Name:     member.Name,
			Nickname: member.Nickname,
			Role:     member.Role,
		})
	}
	return responses
}

func contactGroupAvatarMemberRoleRank(role string) int {
	switch role {
	case store.ConversationMemberRoleOwner:
		return 0
	case store.ConversationMemberRoleAdmin:
		return 1
	default:
		return 2
	}
}

func newContactUserResponse(user store.User, online bool) contactUserResponse {
	phone := ""
	if user.Phone != nil {
		phone = *user.Phone
	}
	avatar := user.Avatar
	if avatar == "" {
		avatar = store.DefaultUserAvatar
	}

	return contactUserResponse{
		Avatar:       avatar,
		Email:        user.Email,
		ID:           user.ID,
		LastOnlineAt: formatOptionalTime(user.LastOnlineAt),
		Name:         user.Name,
		Nickname:     user.Nickname,
		Online:       online,
		Phone:        phone,
		Type:         "user",
	}
}
