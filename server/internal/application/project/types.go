package project

import (
	"context"
	"io"
	"time"
)

const (
	RoleOwner  = "owner"
	RoleMember = "member"
)

type UserSummary struct {
	ID       string
	Name     string
	Nickname string
	Avatar   string
}

type TaskCounts struct {
	Total      int64
	Todo       int64
	InProgress int64
	Done       int64
	Canceled   int64
}

type Project struct {
	ID              string
	Name            string
	Description     string
	Avatar          string
	IsPersonal      bool
	Owner           UserSummary
	CurrentUserRole string
	GroupCount      int64
	MemberCount     int64
	TaskCounts      TaskCounts
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type Summary struct {
	ID          string
	Name        string
	Description string
	Avatar      string
	IsPersonal  bool
	UpdatedAt   time.Time
}

type Group struct {
	ID          string
	Name        string
	Avatar      string
	Status      string
	MemberCount int64
	CreatedAt   time.Time
}

type ConversationProject struct {
	Avatar      string
	Description string
	ID          string
	Name        string
}

type Member struct {
	ID             string
	Name           string
	Nickname       string
	Email          string
	Avatar         string
	Status         string
	DisplayName    string
	Role           string
	SourceGroupIDs []string
}

type ListCommand struct {
	AccountID       string
	Keyword         string
	Limit           int
	Cursor          string
	IncludePersonal bool
}

type ListResult struct {
	PersonalProject  *Summary
	Projects         []Summary
	DetailedProjects []Project
	NextCursor       *string
}

type CreateCommand struct {
	AccountID   string
	Name        string
	Description string
	Avatar      string
	GroupIDs    []string
}

type UpdateCommand struct {
	AccountID   string
	ProjectID   string
	Name        *string
	Description *string
	Avatar      *string
}

type ProjectCommand struct {
	AccountID string
	ProjectID string
}

type ListGroupsCommand struct {
	AccountID string
	ProjectID string
	Limit     int
	Cursor    string
}

type ListGroupsResult struct {
	Groups     []Group
	NextCursor *string
}

type MutateGroupCommand struct {
	AccountID              string
	ProjectID              string
	GroupID                string
	AllowProjectMember     bool
	RequireGroupMembership bool
	RequireGroupManager    bool
}

type GroupMutationResult struct {
	AlreadyLinked bool
	ProjectID     string
	GroupID       string
}

type ListMembersCommand struct {
	AccountID string
	ProjectID string
	Limit     int
	Cursor    string
}

type ListMembersResult struct {
	Members    []Member
	NextCursor *string
}

type UploadAvatarCommand struct {
	AccountID string
	ProjectID string
	Size      int64
	Content   io.Reader
}

type ClientService interface {
	List(context.Context, ListCommand) (ListResult, error)
	Create(context.Context, CreateCommand) (Project, error)
	Get(context.Context, ProjectCommand) (Project, error)
	Update(context.Context, UpdateCommand) (Project, error)
	Delete(context.Context, ProjectCommand) (Project, error)
	ListGroups(context.Context, ListGroupsCommand) (ListGroupsResult, error)
	BindGroup(context.Context, MutateGroupCommand) (GroupMutationResult, error)
	UnbindGroup(context.Context, MutateGroupCommand) error
	ListMembers(context.Context, ListMembersCommand) (ListMembersResult, error)
	UploadAvatar(context.Context, UploadAvatarCommand) (Project, error)
}

type ConversationReader interface {
	ListForConversations(context.Context, []string) (map[string][]ConversationProject, error)
}
