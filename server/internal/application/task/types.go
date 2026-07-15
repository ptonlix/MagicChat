package task

import (
	"context"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
)

const (
	StatusTodo       = "todo"
	StatusInProgress = "in_progress"
	StatusDone       = "done"
	StatusCanceled   = "canceled"

	PriorityLow    int16 = 1
	PriorityMedium int16 = 2
	PriorityHigh   int16 = 3

	DateLayout       = "2006-01-02"
	DefaultPageLimit = 50
	MaxPageLimit     = 100
)

type Field[T any] struct {
	Present bool
	Null    bool
	Value   T
}

type UserSummary struct {
	ID       string
	Name     string
	Nickname string
	Avatar   string
}

type Task struct {
	ID          string
	ProjectID   string
	Title       string
	Description string
	Status      string
	Priority    int16
	Assignee    *UserSummary
	Creator     UserSummary
	StartDate   *string
	DueDate     *string
	Labels      []string
	CompletedAt *time.Time
	CanceledAt  *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type ListCommand struct {
	AccountID string
	ProjectID string
	Keyword   string
	Status    Field[string]
	Priority  Field[string]
	Assignee  Field[string]
	Label     Field[string]
	StartFrom Field[string]
	StartTo   Field[string]
	DueFrom   Field[string]
	DueTo     Field[string]
	Limit     int
	Cursor    Field[string]
}

type ListResult struct {
	Tasks      []Task
	NextCursor *string
}

type CreateCommand struct {
	AccountID      string
	ProjectID      string
	Title          Field[string]
	Description    Field[string]
	Status         Field[string]
	Priority       Field[int16]
	AssigneeUserID Field[string]
	StartDate      Field[string]
	DueDate        Field[string]
	Labels         Field[[]string]
}

type GetCommand struct {
	AccountID string
	ProjectID string
	TaskID    string
}

type UpdateCommand struct {
	AccountID         string
	ProjectID         string
	TaskID            string
	Title             Field[string]
	Description       Field[string]
	Status            Field[string]
	Priority          Field[int16]
	AssigneeUserID    Field[string]
	StartDate         Field[string]
	DueDate           Field[string]
	Labels            Field[[]string]
	ExpectedUpdatedAt *time.Time
}

type ClientService interface {
	List(context.Context, ListCommand) (ListResult, error)
	Create(context.Context, CreateCommand) (Task, error)
	Get(context.Context, GetCommand) (Task, error)
	Update(context.Context, UpdateCommand) (Task, error)
	Delete(context.Context, GetCommand) (string, error)
}

type NotificationPort interface {
	PrepareTaskNotification(context.Context, *gorm.DB, store.Task) (any, error)
	PublishTaskNotification(context.Context, any)
}
