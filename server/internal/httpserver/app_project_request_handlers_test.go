package httpserver

import (
	"encoding/json"
	"testing"
	"time"

	"app/internal/appregistry"
	"app/internal/realtime"
	"app/internal/store"
)

func TestAppWebSocketProjectManagementOperationsUseAuthorizedUser(t *testing.T) {
	server, db := newTestRouter(t)
	defer server.Close()

	now := time.Date(2026, 7, 13, 1, 0, 0, 0, time.UTC)
	owner := insertTestUser(t, db, "app-project-owner@example.com", "Project Owner", store.UserStatusActive, now)
	targetGroup := insertTestConversation(t, db, testConversationInput{
		createdByUserID: owner.ID,
		kind:            store.ConversationKindGroup,
		memberIDs:       []string{owner.ID},
		name:            "Project Target Group",
		now:             now,
	})
	authorizationConversation := insertTestConversation(t, db, testConversationInput{
		createdByUserID: owner.ID,
		kind:            store.ConversationKindGroup,
		memberIDs:       []string{owner.ID},
		name:            "Project Tool Authorization",
		now:             now,
	})
	insertTestAppConversationMember(t, db, appregistry.AIAssistantAppID, authorizationConversation.ID, now)
	trigger := insertTestMessageFromSender(t, db, authorizationConversation.ID, store.MessageSenderTypeUser, owner.ID, 1, "管理项目", now)
	runAs := map[string]any{
		"type":                          "user",
		"id":                            owner.ID,
		"trigger_message_id":            trigger.ID,
		"authorization_conversation_id": authorizationConversation.ID,
	}
	conn := dialAppWebSocket(t, server, appregistry.AIAssistantAppID, "test-ai-assistant-secret")

	createProjectResponse := sendAppRequest(t, conn, realtime.Envelope{
		V:      realtime.ProtocolVersion,
		Kind:   realtime.KindRequest,
		ID:     "projects-create-1",
		Method: appMethodProjectsCreate,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"runas":       runAs,
			"name":        " Agent 发布项目 ",
			"description": "通过项目工具创建",
		}),
	})
	var project projectResponse
	if err := json.Unmarshal(createProjectResponse.Payload, &project); err != nil {
		t.Fatalf("unmarshal project: %v", err)
	}
	if project.ID == "" || project.Name != "Agent 发布项目" || project.Owner.ID != owner.ID || project.CurrentUserRole != store.ProjectRoleOwner {
		t.Fatalf("project = %#v", project)
	}

	listProjectsResponse := sendAppRequest(t, conn, realtime.Envelope{
		V:      realtime.ProtocolVersion,
		Kind:   realtime.KindRequest,
		ID:     "projects-list-1",
		Method: appMethodProjectsList,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"runas":   runAs,
			"keyword": "发布项目",
		}),
	})
	var projectList appListProjectsResponse
	if err := json.Unmarshal(listProjectsResponse.Payload, &projectList); err != nil {
		t.Fatalf("unmarshal project list: %v", err)
	}
	if len(projectList.Projects) != 1 || projectList.Projects[0].ID != project.ID || projectList.RunAs.ID != owner.ID {
		t.Fatalf("project list = %#v", projectList)
	}

	grantResponse := sendAppRequest(t, conn, realtime.Envelope{
		V:      realtime.ProtocolVersion,
		Kind:   realtime.KindRequest,
		ID:     "projects-grant-1",
		Method: appMethodProjectGroupsGrant,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"runas":           runAs,
			"project_id":      project.ID,
			"conversation_id": targetGroup.ID,
		}),
	})
	var grant appGrantProjectGroupResponse
	if err := json.Unmarshal(grantResponse.Payload, &grant); err != nil {
		t.Fatalf("unmarshal grant: %v", err)
	}
	if grant.ProjectID != project.ID || grant.ConversationID != targetGroup.ID || grant.AlreadyGranted {
		t.Fatalf("grant = %#v", grant)
	}

	createTaskResponse := sendAppRequest(t, conn, realtime.Envelope{
		V:      realtime.ProtocolVersion,
		Kind:   realtime.KindRequest,
		ID:     "projects-task-create-1",
		Method: appMethodProjectTasksCreate,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"runas":      runAs,
			"project_id": project.ID,
			"title":      "检查发布清单",
			"priority":   3,
			"labels":     []string{"发布"},
		}),
	})
	var task taskResponse
	if err := json.Unmarshal(createTaskResponse.Payload, &task); err != nil {
		t.Fatalf("unmarshal task: %v", err)
	}
	if task.ID == "" || task.ProjectID != project.ID || task.Creator.ID != owner.ID || task.Status != store.TaskStatusTodo || task.Priority != store.TaskPriorityHigh {
		t.Fatalf("task = %#v", task)
	}

	listTasksResponse := sendAppRequest(t, conn, realtime.Envelope{
		V:      realtime.ProtocolVersion,
		Kind:   realtime.KindRequest,
		ID:     "projects-task-list-1",
		Method: appMethodProjectTasksList,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"runas":      runAs,
			"project_id": project.ID,
			"keyword":    "发布清单",
			"statuses":   []string{store.TaskStatusTodo},
		}),
	})
	var taskList appListProjectTasksResponse
	if err := json.Unmarshal(listTasksResponse.Payload, &taskList); err != nil {
		t.Fatalf("unmarshal task list: %v", err)
	}
	if len(taskList.Tasks) != 1 || taskList.Tasks[0].ID != task.ID || taskList.RunAs.ID != owner.ID {
		t.Fatalf("task list = %#v", taskList)
	}

	updateTaskResponse := sendAppRequest(t, conn, realtime.Envelope{
		V:      realtime.ProtocolVersion,
		Kind:   realtime.KindRequest,
		ID:     "projects-task-update-1",
		Method: appMethodProjectTasksUpdate,
		Payload: mustMarshalPayloadForTest(t, map[string]any{
			"runas":               runAs,
			"project_id":          project.ID,
			"task_id":             task.ID,
			"expected_updated_at": task.UpdatedAt.Format(time.RFC3339Nano),
			"status":              store.TaskStatusDone,
		}),
	})
	var updated taskResponse
	if err := json.Unmarshal(updateTaskResponse.Payload, &updated); err != nil {
		t.Fatalf("unmarshal updated task: %v", err)
	}
	if updated.Status != store.TaskStatusDone || updated.CompletedAt == nil || !updated.UpdatedAt.After(task.UpdatedAt) {
		t.Fatalf("updated task = %#v", updated)
	}
}

func TestAppWebSocketProjectManagementRequiresRunAs(t *testing.T) {
	server, _ := newTestRouter(t)
	defer server.Close()
	conn := dialAppWebSocket(t, server, appregistry.AIAssistantAppID, "test-ai-assistant-secret")
	response := sendRawAppRequest(t, conn, realtime.Envelope{
		V:       realtime.ProtocolVersion,
		Kind:    realtime.KindRequest,
		ID:      "projects-runas-required",
		Method:  appMethodProjectsList,
		Payload: mustMarshalPayloadForTest(t, map[string]any{}),
	})
	if response.OK == nil || *response.OK || response.Error == nil || response.Error.Code != "invalid_request" {
		t.Fatalf("response = %#v, want required user runas", response)
	}
}
