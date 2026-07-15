package task

import (
	"context"
	"testing"
	"time"

	"app/internal/store"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestServiceTaskLifecycleAndNotificationPort(t *testing.T) {
	db := openTaskTestDB(t)
	now := time.Date(2026, 7, 15, 6, 0, 0, 0, time.UTC)
	owner := insertTaskTestUser(t, db, "owner@example.com", now)
	project := store.Project{
		ID: uuid.NewString(), Name: "Release", OwnerUserID: owner.ID, CreatedByUserID: owner.ID,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := db.Create(&project).Error; err != nil {
		t.Fatalf("create project: %v", err)
	}
	notifications := &taskNotificationRecorder{}
	service := NewService(Dependencies{DB: db, Notifications: notifications, Now: func() time.Time { return now }})

	created, err := service.Create(context.Background(), CreateCommand{
		AccountID:      owner.ID,
		ProjectID:      project.ID,
		Title:          Field[string]{Present: true, Value: "  Ship release  "},
		AssigneeUserID: Field[string]{Present: true, Value: owner.ID},
		Labels:         Field[[]string]{Present: true, Value: []string{"Release", "release"}},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.Title != "Ship release" || created.Status != StatusTodo || created.Assignee == nil || len(created.Labels) != 1 {
		t.Fatalf("created task = %#v", created)
	}
	if notifications.prepared != 1 || notifications.published != 1 {
		t.Fatalf("notifications = prepared %d, published %d", notifications.prepared, notifications.published)
	}

	now = now.Add(time.Minute)
	updated, err := service.Update(context.Background(), UpdateCommand{
		AccountID: owner.ID,
		ProjectID: project.ID,
		TaskID:    created.ID,
		Status:    Field[string]{Present: true, Value: StatusDone},
	})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Status != StatusDone || updated.CompletedAt == nil || updated.CanceledAt != nil {
		t.Fatalf("updated task = %#v", updated)
	}

	listed, err := service.List(context.Background(), ListCommand{
		AccountID: owner.ID,
		ProjectID: project.ID,
		Status:    Field[string]{Present: true, Value: StatusDone},
	})
	if err != nil || len(listed.Tasks) != 1 || listed.Tasks[0].ID != created.ID {
		t.Fatalf("list = %#v, err = %v", listed, err)
	}

	now = now.Add(time.Minute)
	deletedID, err := service.Delete(context.Background(), GetCommand{AccountID: owner.ID, ProjectID: project.ID, TaskID: created.ID})
	if err != nil || deletedID != created.ID {
		t.Fatalf("delete id = %q, err = %v", deletedID, err)
	}
	if _, err := service.Get(context.Background(), GetCommand{AccountID: owner.ID, ProjectID: project.ID, TaskID: created.ID}); ErrorCodeOf(err) != CodeNotFound {
		t.Fatalf("get deleted error = %v, code = %q", err, ErrorCodeOf(err))
	}
}

func TestServiceRejectsInvalidTaskCombinations(t *testing.T) {
	db := openTaskTestDB(t)
	now := time.Date(2026, 7, 15, 6, 0, 0, 0, time.UTC)
	owner := insertTaskTestUser(t, db, "owner@example.com", now)
	project := store.Project{ID: uuid.NewString(), Name: "Release", OwnerUserID: owner.ID, CreatedByUserID: owner.ID, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&project).Error; err != nil {
		t.Fatalf("create project: %v", err)
	}
	service := NewService(Dependencies{DB: db})

	_, err := service.Create(context.Background(), CreateCommand{
		AccountID: owner.ID, ProjectID: project.ID,
		Title:     Field[string]{Present: true, Value: "Invalid dates"},
		StartDate: Field[string]{Present: true, Value: "2026-07-20"},
		DueDate:   Field[string]{Present: true, Value: "2026-07-19"},
	})
	if ErrorCodeOf(err) != CodeInvalidRequest || ErrorMessage(err) != "开始日期不能晚于截止日期" {
		t.Fatalf("create error = %v, code = %q", err, ErrorCodeOf(err))
	}
}

type taskNotificationRecorder struct{ prepared, published int }

func (s *taskNotificationRecorder) PrepareTaskNotification(_ context.Context, tx *gorm.DB, value store.Task) (any, error) {
	s.prepared++
	var count int64
	if err := tx.Model(&store.Task{}).Where("id = ?", value.ID).Count(&count).Error; err != nil {
		return nil, err
	}
	return value.ID, nil
}

func (s *taskNotificationRecorder) PublishTaskNotification(_ context.Context, prepared any) {
	if prepared != nil {
		s.published++
	}
}

func openTaskTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(
		&store.User{},
		&store.Project{},
		&store.Conversation{},
		&store.ProjectGroup{},
		&store.ConversationMember{},
		&store.Task{},
	); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	return db
}

func insertTaskTestUser(t *testing.T, db *gorm.DB, email string, now time.Time) store.User {
	t.Helper()
	user := store.User{ID: uuid.NewString(), Email: email, Name: "Owner", Avatar: store.DefaultUserAvatar, PasswordHash: "hash", Status: store.UserStatusActive, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	return user
}
