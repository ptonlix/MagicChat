package builtintools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"assistant/internal/mcpclient"
)

const (
	projectsToolName                  = "projects"
	projectsOperationSearchProjects   = "search_projects"
	projectsOperationCreateProject    = "create_project"
	projectsOperationGrantGroupAccess = "grant_group_access"
	projectsOperationSearchTasks      = "search_tasks"
	projectsOperationCreateTask       = "create_task"
	projectsOperationUpdateTask       = "update_task"
	methodProjectsList                = "projects.list"
	methodProjectsCreate              = "projects.create"
	methodProjectGroupsGrant          = "projects.groups.grant"
	methodProjectTasksList            = "projects.tasks.list"
	methodProjectTasksCreate          = "projects.tasks.create"
	methodProjectTasksUpdate          = "projects.tasks.update"
)

type projectsInput struct {
	Operation string          `json:"operation"`
	Arguments json.RawMessage `json:"arguments"`
	RunAs     *runAsInput     `json:"runas"`
}

func callProjects(ctx context.Context, input json.RawMessage) (mcpclient.ToolResult, error) {
	var parsed projectsInput
	if err := json.Unmarshal(input, &parsed); err != nil {
		return mcpclient.ToolResult{}, fmt.Errorf("parse projects input: %w", err)
	}
	parsed.Operation = strings.ToLower(strings.TrimSpace(parsed.Operation))
	method, ok := map[string]string{
		projectsOperationSearchProjects:   methodProjectsList,
		projectsOperationCreateProject:    methodProjectsCreate,
		projectsOperationGrantGroupAccess: methodProjectGroupsGrant,
		projectsOperationSearchTasks:      methodProjectTasksList,
		projectsOperationCreateTask:       methodProjectTasksCreate,
		projectsOperationUpdateTask:       methodProjectTasksUpdate,
	}[parsed.Operation]
	if !ok {
		return mcpclient.ToolResult{}, fmt.Errorf("unsupported projects operation %q; use help to inspect supported operations", parsed.Operation)
	}
	scope, err := requireScope(ctx)
	if err != nil {
		return mcpclient.ToolResult{}, err
	}
	authorization, err := authorizedRunAs(scope, parsed.RunAs)
	if err != nil {
		return mcpclient.ToolResult{}, err
	}
	arguments := map[string]any{}
	if len(parsed.Arguments) == 0 || string(parsed.Arguments) == "null" {
		return mcpclient.ToolResult{}, fmt.Errorf("arguments is required for projects operation %q", parsed.Operation)
	}
	if err := json.Unmarshal(parsed.Arguments, &arguments); err != nil {
		return mcpclient.ToolResult{}, fmt.Errorf("parse projects %s arguments: %w", parsed.Operation, err)
	}
	arguments["runas"] = runAsPayload{
		AuthorizationConversationID: strings.TrimSpace(scope.ConversationID),
		ID:                          authorization.ActorID,
		TriggerMessageID:            authorization.TriggerMessageID,
		Type:                        authorization.ActorType,
	}
	return requestTool(ctx, scope.Requester, method, arguments)
}
