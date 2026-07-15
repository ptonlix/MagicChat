package client

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"app/internal/application/project"

	"github.com/labstack/echo/v4"
)

type ProjectAPI struct {
	projects project.ClientService
}

type projectOptionalString struct {
	Present bool
	Value   string
}

type projectOptionalStringSlice struct {
	Present bool
	Value   []string
}

type createProjectRequest struct {
	Name        projectOptionalString      `json:"name" swaggertype:"string" binding:"required" example:"新版发布"`
	Description projectOptionalString      `json:"description" swaggertype:"string" example:"协调新版发布工作"`
	Avatar      projectOptionalString      `json:"avatar" swaggertype:"string" example:"/assets/avatars/projects/release.webp"`
	GroupIDs    projectOptionalStringSlice `json:"group_ids" swaggertype:"array,string" example:"7f8d8b84-6d2c-4b12-9a8a-019a7e2787d4"`
}

type updateProjectRequest struct {
	Name        projectOptionalString `json:"name" swaggertype:"string" example:"新版发布"`
	Description projectOptionalString `json:"description" swaggertype:"string" example:"协调新版发布工作"`
	Avatar      projectOptionalString `json:"avatar" swaggertype:"string" example:"/assets/avatars/projects/release.webp"`
}

type projectUserResponse struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
}

type projectTaskCountsResponse struct {
	Total      int64 `json:"total"`
	Todo       int64 `json:"todo"`
	InProgress int64 `json:"in_progress"`
	Done       int64 `json:"done"`
	Canceled   int64 `json:"canceled"`
}

type projectResponse struct {
	ID              string                    `json:"id"`
	Name            string                    `json:"name"`
	Description     string                    `json:"description"`
	Avatar          string                    `json:"avatar"`
	IsPersonal      bool                      `json:"is_personal"`
	Owner           projectUserResponse       `json:"owner"`
	CurrentUserRole string                    `json:"current_user_role"`
	GroupCount      int64                     `json:"group_count"`
	MemberCount     int64                     `json:"member_count"`
	TaskCounts      projectTaskCountsResponse `json:"task_counts"`
	CreatedAt       time.Time                 `json:"created_at"`
	UpdatedAt       time.Time                 `json:"updated_at"`
}

type projectSummaryResponse struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Avatar      string    `json:"avatar"`
	IsPersonal  bool      `json:"is_personal"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type projectListResponse struct {
	PersonalProject projectSummaryResponse   `json:"personal_project"`
	Projects        []projectSummaryResponse `json:"projects"`
	NextCursor      *string                  `json:"next_cursor" extensions:"x-nullable"`
}

type projectGroupResponse struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Avatar      string    `json:"avatar"`
	Status      string    `json:"status"`
	MemberCount int64     `json:"member_count"`
	CreatedAt   time.Time `json:"created_at"`
}

type projectGroupListResponse struct {
	Groups     []projectGroupResponse `json:"groups"`
	NextCursor *string                `json:"next_cursor" extensions:"x-nullable"`
}

type projectMemberResponse struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	Nickname       string   `json:"nickname"`
	Email          string   `json:"email"`
	Avatar         string   `json:"avatar"`
	Status         string   `json:"status"`
	DisplayName    string   `json:"display_name"`
	Role           string   `json:"role"`
	SourceGroupIDs []string `json:"source_group_ids"`
}

type projectMemberListResponse struct {
	Members    []projectMemberResponse `json:"members"`
	NextCursor *string                 `json:"next_cursor" extensions:"x-nullable"`
}

type projectGroupMutationResponse struct{}

func NewProjectAPI(projects project.ClientService) *ProjectAPI {
	return &ProjectAPI{projects: projects}
}

func (a *ProjectAPI) RegisterRoutes(group *echo.Group) {
	group.GET("/projects", a.list)
	group.POST("/projects", a.create)
	group.GET("/projects/:project_id/groups", a.listGroups)
	group.PUT("/projects/:project_id/groups/:group_id", a.bindGroup)
	group.DELETE("/projects/:project_id/groups/:group_id", a.unbindGroup)
	group.GET("/projects/:project_id/members", a.listMembers)
	group.GET("/projects/:project_id", a.get)
	group.PATCH("/projects/:project_id", a.update)
	group.DELETE("/projects/:project_id", a.delete)
	group.POST("/projects/:project_id/avatar", a.uploadAvatar)
}

// list godoc
//
// @Summary 列出项目
// @Description 获取当前用户可访问的项目及个人项目，按更新时间倒序分页。
// @Tags 客户端项目
// @Produce json
// @Param limit query int false "每页数量，默认 50，最大 100"
// @Param cursor query string false "项目分页游标"
// @Success 200 {object} successEnvelope{data=projectListResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/projects [get]
func (a *ProjectAPI) list(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, http.StatusInternalServerError, string(project.CodeInternal), "服务端错误")
	}
	limit, err := parsePageLimit(c.QueryParam("limit"))
	if err != nil {
		return writeProjectError(c, err)
	}
	result, err := a.projects.List(c.Request().Context(), project.ListCommand{AccountID: current.ID, Limit: limit, Cursor: c.QueryParam("cursor"), IncludePersonal: true})
	if err != nil {
		return writeProjectError(c, err)
	}
	projects := make([]projectSummaryResponse, 0, len(result.Projects))
	for _, value := range result.Projects {
		projects = append(projects, newProjectSummaryResponse(value))
	}
	personal := projectSummaryResponse{}
	if result.PersonalProject != nil {
		personal = newProjectSummaryResponse(*result.PersonalProject)
	}
	return writeSuccess(c, http.StatusOK, projectListResponse{PersonalProject: personal, Projects: projects, NextCursor: result.NextCursor})
}

// create godoc
//
// @Summary 创建项目
// @Description 创建普通项目，可同时关联当前可用的群聊。
// @Tags 客户端项目
// @Accept json
// @Produce json
// @Param body body createProjectRequest true "项目信息"
// @Success 201 {object} successEnvelope{data=projectResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/projects [post]
func (a *ProjectAPI) create(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, 500, string(project.CodeInternal), "服务端错误")
	}
	var req createProjectRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		return writeFailure(c, 400, string(project.CodeInvalidRequest), "请求格式错误")
	}
	value, err := a.projects.Create(c.Request().Context(), project.CreateCommand{AccountID: current.ID, Name: req.Name.Value, Description: req.Description.Value, Avatar: req.Avatar.Value, GroupIDs: req.GroupIDs.Value})
	if err != nil {
		return writeProjectError(c, err)
	}
	return writeSuccess(c, http.StatusCreated, newProjectResponse(value))
}

// get godoc
//
// @Summary 获取项目
// @Description 获取当前用户可访问的项目详情和任务统计。
// @Tags 客户端项目
// @Produce json
// @Param project_id path string true "项目 ID"
// @Success 200 {object} successEnvelope{data=projectResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/projects/{project_id} [get]
func (a *ProjectAPI) get(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, 500, string(project.CodeInternal), "服务端错误")
	}
	value, err := a.projects.Get(c.Request().Context(), project.ProjectCommand{AccountID: current.ID, ProjectID: c.Param("project_id")})
	if err != nil {
		return writeProjectError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newProjectResponse(value))
}

// update godoc
//
// @Summary 更新项目
// @Description 项目所有者更新项目名称、描述或头像。
// @Tags 客户端项目
// @Accept json
// @Produce json
// @Param project_id path string true "项目 ID"
// @Param body body updateProjectRequest true "项目更新信息"
// @Success 200 {object} successEnvelope{data=projectResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 403 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/projects/{project_id} [patch]
func (a *ProjectAPI) update(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, 500, string(project.CodeInternal), "服务端错误")
	}
	var req updateProjectRequest
	if err := decodeStrictJSON(c, &req); err != nil {
		return writeFailure(c, 400, string(project.CodeInvalidRequest), "请求格式错误")
	}
	cmd := project.UpdateCommand{AccountID: current.ID, ProjectID: c.Param("project_id")}
	if req.Name.Present {
		cmd.Name = &req.Name.Value
	}
	if req.Description.Present {
		cmd.Description = &req.Description.Value
	}
	if req.Avatar.Present {
		cmd.Avatar = &req.Avatar.Value
	}
	value, err := a.projects.Update(c.Request().Context(), cmd)
	if err != nil {
		return writeProjectError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newProjectResponse(value))
}

// delete godoc
//
// @Summary 删除项目
// @Description 项目所有者删除普通项目；个人项目不能删除。
// @Tags 客户端项目
// @Produce json
// @Param project_id path string true "项目 ID"
// @Success 200 {object} successEnvelope{data=projectResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 403 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/projects/{project_id} [delete]
func (a *ProjectAPI) delete(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, 500, string(project.CodeInternal), "服务端错误")
	}
	value, err := a.projects.Delete(c.Request().Context(), project.ProjectCommand{AccountID: current.ID, ProjectID: c.Param("project_id")})
	if err != nil {
		return writeProjectError(c, err)
	}
	return writeSuccess(c, http.StatusOK, newProjectResponse(value))
}

// listGroups godoc
//
// @Summary 列出项目群聊
// @Description 获取项目关联的可用群聊，按关联时间倒序分页。
// @Tags 客户端项目
// @Produce json
// @Param project_id path string true "项目 ID"
// @Param limit query int false "每页数量，默认 50，最大 100"
// @Param cursor query string false "群聊分页游标"
// @Success 200 {object} successEnvelope{data=projectGroupListResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/projects/{project_id}/groups [get]
func (a *ProjectAPI) listGroups(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, 500, string(project.CodeInternal), "服务端错误")
	}
	limit, err := parsePageLimit(c.QueryParam("limit"))
	if err != nil {
		return writeProjectError(c, err)
	}
	result, err := a.projects.ListGroups(c.Request().Context(), project.ListGroupsCommand{AccountID: current.ID, ProjectID: c.Param("project_id"), Limit: limit, Cursor: c.QueryParam("cursor")})
	if err != nil {
		return writeProjectError(c, err)
	}
	groups := make([]projectGroupResponse, 0, len(result.Groups))
	for _, value := range result.Groups {
		groups = append(groups, projectGroupResponse{ID: value.ID, Name: value.Name, Avatar: value.Avatar, Status: value.Status, MemberCount: value.MemberCount, CreatedAt: value.CreatedAt})
	}
	return writeSuccess(c, 200, projectGroupListResponse{Groups: groups, NextCursor: result.NextCursor})
}

// bindGroup godoc
//
// @Summary 关联项目群聊
// @Description 项目所有者将可用群聊关联到普通项目；重复关联保持成功。
// @Tags 客户端项目
// @Produce json
// @Param project_id path string true "项目 ID"
// @Param group_id path string true "群聊 ID"
// @Success 200 {object} successEnvelope{data=projectGroupMutationResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 403 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 409 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/projects/{project_id}/groups/{group_id} [put]
func (a *ProjectAPI) bindGroup(c echo.Context) error { return a.mutateGroup(c, true) }

// unbindGroup godoc
//
// @Summary 解除项目群聊
// @Description 项目所有者解除普通项目与群聊的关联；未关联时保持成功。
// @Tags 客户端项目
// @Produce json
// @Param project_id path string true "项目 ID"
// @Param group_id path string true "群聊 ID"
// @Success 200 {object} successEnvelope{data=projectGroupMutationResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 403 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/projects/{project_id}/groups/{group_id} [delete]
func (a *ProjectAPI) unbindGroup(c echo.Context) error { return a.mutateGroup(c, false) }

func (a *ProjectAPI) mutateGroup(c echo.Context, bind bool) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, 500, string(project.CodeInternal), "服务端错误")
	}
	cmd := project.MutateGroupCommand{AccountID: current.ID, ProjectID: c.Param("project_id"), GroupID: c.Param("group_id")}
	var err error
	if bind {
		_, err = a.projects.BindGroup(c.Request().Context(), cmd)
	} else {
		err = a.projects.UnbindGroup(c.Request().Context(), cmd)
	}
	if err != nil {
		return writeProjectError(c, err)
	}
	return writeSuccess(c, 200, map[string]any{})
}

// listMembers godoc
//
// @Summary 列出项目成员
// @Description 获取项目成员及其来源群聊，按显示名称分页。
// @Tags 客户端项目
// @Produce json
// @Param project_id path string true "项目 ID"
// @Param limit query int false "每页数量，默认 50，最大 100"
// @Param cursor query string false "成员分页游标"
// @Success 200 {object} successEnvelope{data=projectMemberListResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/projects/{project_id}/members [get]
func (a *ProjectAPI) listMembers(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, 500, string(project.CodeInternal), "服务端错误")
	}
	limit, err := parsePageLimit(c.QueryParam("limit"))
	if err != nil {
		return writeProjectError(c, err)
	}
	result, err := a.projects.ListMembers(c.Request().Context(), project.ListMembersCommand{AccountID: current.ID, ProjectID: c.Param("project_id"), Limit: limit, Cursor: c.QueryParam("cursor")})
	if err != nil {
		return writeProjectError(c, err)
	}
	members := make([]projectMemberResponse, 0, len(result.Members))
	for _, value := range result.Members {
		members = append(members, projectMemberResponse{ID: value.ID, Name: value.Name, Nickname: value.Nickname, Email: value.Email, Avatar: value.Avatar, Status: value.Status, DisplayName: value.DisplayName, Role: value.Role, SourceGroupIDs: value.SourceGroupIDs})
	}
	return writeSuccess(c, 200, projectMemberListResponse{Members: members, NextCursor: result.NextCursor})
}

// uploadAvatar godoc
//
// @Summary 上传项目头像
// @Description 项目所有者上传裁切后的 WebP 项目头像。头像必须是 256x256，文件会写入 public bucket。
// @Tags 客户端项目
// @Accept multipart/form-data
// @Produce json
// @Param project_id path string true "项目 ID"
// @Param file formData file true "WebP 项目头像"
// @Success 200 {object} successEnvelope{data=projectResponse}
// @Failure 400 {object} errorEnvelope
// @Failure 401 {object} errorEnvelope
// @Failure 403 {object} errorEnvelope
// @Failure 404 {object} errorEnvelope
// @Failure 413 {object} errorEnvelope
// @Failure 500 {object} errorEnvelope
// @Security UserSession
// @Router /api/client/projects/{project_id}/avatar [post]
func (a *ProjectAPI) uploadAvatar(c echo.Context) error {
	current, ok := CurrentAccount(c)
	if !ok {
		return writeFailure(c, 500, string(project.CodeInternal), "服务端错误")
	}
	c.Request().Body = http.MaxBytesReader(c.Response().Writer, c.Request().Body, maxAvatarRequestBytes)
	header, err := c.FormFile("file")
	if err != nil {
		if isRequestBodyTooLarge(err) {
			return writeFailure(c, 413, string(project.CodeRequestTooLarge), "项目头像文件不能超过 1MiB")
		}
		return writeFailure(c, 400, string(project.CodeInvalidRequest), "请选择要上传的项目头像")
	}
	file, err := header.Open()
	if err != nil {
		return writeFailure(c, 400, string(project.CodeInvalidRequest), "读取项目头像失败")
	}
	defer file.Close()
	value, err := a.projects.UploadAvatar(c.Request().Context(), project.UploadAvatarCommand{AccountID: current.ID, ProjectID: c.Param("project_id"), Size: header.Size, Content: file})
	if err != nil {
		return writeProjectError(c, err)
	}
	return writeSuccess(c, 200, newProjectResponse(value))
}

func (value *projectOptionalString) UnmarshalJSON(raw []byte) error {
	value.Present = true
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return errors.New("字符串字段不能为 null")
	}
	return json.Unmarshal(raw, &value.Value)
}
func (value *projectOptionalStringSlice) UnmarshalJSON(raw []byte) error {
	value.Present = true
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return errors.New("字符串数组字段不能为 null")
	}
	return json.Unmarshal(raw, &value.Value)
}

func decodeStrictJSON(c echo.Context, destination any) error {
	decoder := json.NewDecoder(c.Request().Body)
	var raw json.RawMessage
	if err := decoder.Decode(&raw); err != nil {
		return err
	}
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return errors.New("请求不能为 null")
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("请求只能包含一个 JSON 对象")
		}
		return err
	}
	strict := json.NewDecoder(bytes.NewReader(raw))
	strict.DisallowUnknownFields()
	return strict.Decode(destination)
}

func parsePageLimit(raw string) (int, error) {
	if raw == "" {
		return 0, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 1 || value > project.MaxPageLimit {
		return 0, &project.Error{Code: project.CodeInvalidRequest, Message: "limit 必须为 1 到 100 的整数", Cause: err}
	}
	return value, nil
}

func newProjectSummaryResponse(value project.Summary) projectSummaryResponse {
	return projectSummaryResponse{ID: value.ID, Name: value.Name, Description: value.Description, Avatar: value.Avatar, IsPersonal: value.IsPersonal, UpdatedAt: value.UpdatedAt}
}

func newProjectResponse(value project.Project) projectResponse {
	return projectResponse{ID: value.ID, Name: value.Name, Description: value.Description, Avatar: value.Avatar, IsPersonal: value.IsPersonal, Owner: projectUserResponse{ID: value.Owner.ID, Name: value.Owner.Name, Nickname: value.Owner.Nickname, Avatar: value.Owner.Avatar}, CurrentUserRole: value.CurrentUserRole, GroupCount: value.GroupCount, MemberCount: value.MemberCount, TaskCounts: projectTaskCountsResponse{Total: value.TaskCounts.Total, Todo: value.TaskCounts.Todo, InProgress: value.TaskCounts.InProgress, Done: value.TaskCounts.Done, Canceled: value.TaskCounts.Canceled}, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt}
}

func writeProjectError(c echo.Context, err error) error {
	status := http.StatusInternalServerError
	switch project.ErrorCodeOf(err) {
	case project.CodeInvalidRequest:
		status = 400
	case project.CodeForbidden:
		status = 403
	case project.CodeNotFound:
		status = 404
	case project.CodeConflict:
		status = 409
	case project.CodeRequestTooLarge:
		status = 413
	}
	return writeFailure(c, status, string(project.ErrorCodeOf(err)), project.ErrorMessage(err))
}
