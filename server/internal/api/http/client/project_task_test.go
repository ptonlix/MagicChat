package client

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"app/internal/application/account"
	"app/internal/application/project"
	"app/internal/application/task"

	"github.com/labstack/echo/v4"
)

func TestProjectAndTaskAPIsMapAuthenticatedAccountToApplicationCommands(t *testing.T) {
	projects := &fakeProjectService{}
	tasks := &fakeTaskService{}
	router := echo.New()
	group := router.Group("/api/client", func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			c.Set(currentAccountKey, account.Account{ID: "account-1"})
			return next(c)
		}
	})
	NewProjectAPI(projects).RegisterRoutes(group)
	NewTaskAPI(tasks).RegisterRoutes(group)

	projectRequest := httptest.NewRequest(http.MethodPost, "/api/client/projects", bytes.NewBufferString(`{"name":"Release"}`))
	projectRequest.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	projectRecorder := httptest.NewRecorder()
	router.ServeHTTP(projectRecorder, projectRequest)
	if projectRecorder.Code != http.StatusCreated || projects.create.AccountID != "account-1" || projects.create.Name != "Release" {
		t.Fatalf("project status = %d, command = %#v, body = %s", projectRecorder.Code, projects.create, projectRecorder.Body.String())
	}

	taskRequest := httptest.NewRequest(http.MethodPost, "/api/client/projects/project-1/tasks", bytes.NewBufferString(`{"title":"Ship","assignee_user_id":null}`))
	taskRequest.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	taskRecorder := httptest.NewRecorder()
	router.ServeHTTP(taskRecorder, taskRequest)
	if taskRecorder.Code != http.StatusCreated || tasks.create.AccountID != "account-1" || tasks.create.ProjectID != "project-1" || !tasks.create.AssigneeUserID.Null {
		t.Fatalf("task status = %d, command = %#v, body = %s", taskRecorder.Code, tasks.create, taskRecorder.Body.String())
	}
}

type fakeProjectService struct{ create project.CreateCommand }

func (s *fakeProjectService) List(context.Context, project.ListCommand) (project.ListResult, error) {
	return project.ListResult{}, nil
}
func (s *fakeProjectService) Create(_ context.Context, cmd project.CreateCommand) (project.Project, error) {
	s.create = cmd
	return project.Project{ID: "project-1", Name: cmd.Name, Owner: project.UserSummary{ID: cmd.AccountID}, CreatedAt: time.Now()}, nil
}
func (s *fakeProjectService) Get(context.Context, project.ProjectCommand) (project.Project, error) {
	return project.Project{}, nil
}
func (s *fakeProjectService) Update(context.Context, project.UpdateCommand) (project.Project, error) {
	return project.Project{}, nil
}
func (s *fakeProjectService) Delete(context.Context, project.ProjectCommand) (project.Project, error) {
	return project.Project{}, nil
}
func (s *fakeProjectService) ListGroups(context.Context, project.ListGroupsCommand) (project.ListGroupsResult, error) {
	return project.ListGroupsResult{}, nil
}
func (s *fakeProjectService) BindGroup(context.Context, project.MutateGroupCommand) (project.GroupMutationResult, error) {
	return project.GroupMutationResult{}, nil
}
func (s *fakeProjectService) UnbindGroup(context.Context, project.MutateGroupCommand) error {
	return nil
}
func (s *fakeProjectService) ListMembers(context.Context, project.ListMembersCommand) (project.ListMembersResult, error) {
	return project.ListMembersResult{}, nil
}
func (s *fakeProjectService) UploadAvatar(context.Context, project.UploadAvatarCommand) (project.Project, error) {
	return project.Project{}, nil
}

type fakeTaskService struct{ create task.CreateCommand }

func (s *fakeTaskService) List(context.Context, task.ListCommand) (task.ListResult, error) {
	return task.ListResult{}, nil
}
func (s *fakeTaskService) Create(_ context.Context, cmd task.CreateCommand) (task.Task, error) {
	s.create = cmd
	return task.Task{ID: "task-1", ProjectID: cmd.ProjectID, Title: cmd.Title.Value, Labels: []string{}, CreatedAt: time.Now()}, nil
}
func (s *fakeTaskService) Get(context.Context, task.GetCommand) (task.Task, error) {
	return task.Task{}, nil
}
func (s *fakeTaskService) Update(context.Context, task.UpdateCommand) (task.Task, error) {
	return task.Task{}, nil
}
func (s *fakeTaskService) Delete(context.Context, task.GetCommand) (string, error) {
	return "task-1", nil
}
