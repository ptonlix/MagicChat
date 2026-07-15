package httpserver

import (
	"bytes"
	"encoding/json"
	"time"
)

type taskResponse struct {
	ID          string              `json:"id"`
	ProjectID   string              `json:"project_id"`
	Title       string              `json:"title"`
	Description string              `json:"description"`
	Status      string              `json:"status"`
	Priority    int16               `json:"priority"`
	Assignee    *projectUserSummary `json:"assignee" extensions:"x-nullable"`
	Creator     projectUserSummary  `json:"creator"`
	StartDate   *string             `json:"start_date" extensions:"x-nullable"`
	DueDate     *string             `json:"due_date" extensions:"x-nullable"`
	Labels      []string            `json:"labels"`
	CompletedAt *time.Time          `json:"completed_at" extensions:"x-nullable"`
	CanceledAt  *time.Time          `json:"canceled_at" extensions:"x-nullable"`
	CreatedAt   time.Time           `json:"created_at"`
	UpdatedAt   time.Time           `json:"updated_at"`
}

type taskOptionalString struct {
	Present bool
	Null    bool
	Value   string
}

type taskOptionalInt16 struct {
	Present bool
	Null    bool
	Value   int16
}

type taskOptionalStringSlice struct {
	Present bool
	Null    bool
	Value   []string
}

func (value *taskOptionalString) UnmarshalJSON(raw []byte) error {
	value.Present = true
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		value.Null = true
		return nil
	}
	return json.Unmarshal(raw, &value.Value)
}

func (value *taskOptionalInt16) UnmarshalJSON(raw []byte) error {
	value.Present = true
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		value.Null = true
		return nil
	}
	return json.Unmarshal(raw, &value.Value)
}

func (value *taskOptionalStringSlice) UnmarshalJSON(raw []byte) error {
	value.Present = true
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		value.Null = true
		return nil
	}
	return json.Unmarshal(raw, &value.Value)
}
