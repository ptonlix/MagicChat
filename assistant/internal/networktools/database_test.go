package networktools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"assistant/internal/publicnet"
)

func TestDatabaseQueryToolNormalizesInputAndUsesFixedTimeout(t *testing.T) {
	var captured databaseQueryInput
	source := &Source{
		guard: publicnet.NewGuard(),
		mysql: func(ctx context.Context, _ *publicnet.Guard, input databaseQueryInput) (databaseQueryResult, error) {
			captured = input
			deadline, ok := ctx.Deadline()
			if !ok {
				t.Fatal("query context has no deadline")
			}
			remaining := time.Until(deadline)
			if remaining <= 0 || remaining > databaseQueryTimeout {
				t.Fatalf("query timeout = %v, want <= %v", remaining, databaseQueryTimeout)
			}
			return databaseQueryResult{
				Columns:  []string{"status", "count"},
				Rows:     [][]any{{"todo", int64(2)}},
				RowCount: 1,
			}, nil
		},
	}
	result, err := source.CallTool(context.Background(), mysqlQueryToolName, json.RawMessage(`{
		"connection": {
			"host": "8.8.8.8",
			"database": " analytics ",
			"username": " reader ",
			"password": "secret"
		},
		"query": " SELECT status, COUNT(*) AS count FROM tasks GROUP BY status "
	}`))
	if err != nil {
		t.Fatalf("CallTool() error = %v", err)
	}
	if captured.Connection.Port != 3306 || captured.Connection.TLSMode != "verify-full" || captured.Connection.Database != "analytics" || captured.Connection.Username != "reader" {
		t.Fatalf("captured connection = %#v", captured.Connection)
	}
	if captured.Query != "SELECT status, COUNT(*) AS count FROM tasks GROUP BY status" {
		t.Fatalf("captured query = %q", captured.Query)
	}
	var response databaseQueryResult
	if err := json.Unmarshal([]byte(result.Content), &response); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}
	if response.RowCount != 1 || len(response.Rows) != 1 || response.Truncated {
		t.Fatalf("response = %#v", response)
	}
}

func TestDatabaseQueryToolRejectsPrivateHostBeforeConnecting(t *testing.T) {
	called := false
	source := &Source{
		guard: publicnet.NewGuard(),
		postgres: func(context.Context, *publicnet.Guard, databaseQueryInput) (databaseQueryResult, error) {
			called = true
			return databaseQueryResult{}, nil
		},
	}
	_, err := source.CallTool(context.Background(), postgresQueryToolName, json.RawMessage(`{
		"connection": {
			"host": "192.168.1.10",
			"port": 5432,
			"database": "analytics",
			"username": "reader",
			"password": "secret"
		},
		"query": "SELECT 1"
	}`))
	if err == nil || !strings.Contains(err.Error(), "non-public") {
		t.Fatalf("CallTool() error = %v, want non-public rejection", err)
	}
	if called {
		t.Fatal("database runner was called for private host")
	}
}

func TestValidateReadOnlyQuery(t *testing.T) {
	allowed := []string{
		"SELECT * FROM users",
		"/* context */ WITH totals AS (SELECT COUNT(*) AS count FROM tasks) SELECT * FROM totals",
		"SHOW TABLES",
		"DESCRIBE users",
		"EXPLAIN SELECT * FROM users",
		"SELECT ';' AS separator; -- trailing comment",
		"SELECT $$a;b$$ AS value",
	}
	for _, query := range allowed {
		if err := validateReadOnlyQuery(query); err != nil {
			t.Errorf("validateReadOnlyQuery(%q) error = %v", query, err)
		}
	}

	rejected := []string{
		"",
		"UPDATE users SET status = 'disabled'",
		"DELETE FROM users",
		"INSERT INTO users(id) VALUES (1)",
		"CREATE TABLE demo(id int)",
		"SET transaction_read_only = off",
		"SELECT 1; SELECT 2",
		"WITH removed AS (DELETE FROM users RETURNING id) SELECT * FROM removed",
		"EXPLAIN ANALYZE DELETE FROM users",
		"EXPLAIN ANALYZE CREATE TABLE copied AS SELECT * FROM users",
		"SELECT * FROM users INTO/**/OUTFILE '/tmp/users.csv'",
		"SELECT * FROM users /*! INTO OUTFILE '/tmp/users.csv' */",
		"SELECT * FROM users /*M! INTO DUMPFILE '/tmp/users.bin' */",
		"SELECT 1--x INTO/**/OUTFILE '/tmp/users.csv' FROM users",
	}
	for _, query := range rejected {
		if err := validateReadOnlyQuery(query); err == nil {
			t.Errorf("validateReadOnlyQuery(%q) error = nil", query)
		}
	}
}

func TestValidateReadOnlyQueryAllowsExecutableCommentMarkersInLiterals(t *testing.T) {
	for _, query := range []string{
		"SELECT '/*! not a comment */' AS value",
		"SELECT $$/*M! not a comment */$$ AS value",
		"SELECT 1 -- /*! harmless inside a line comment */",
	} {
		if err := validateReadOnlyQuery(query); err != nil {
			t.Errorf("validateReadOnlyQuery(%q) error = %v", query, err)
		}
	}
}

type fakeDatabaseRows struct {
	columns []string
	current int
	err     error
	rows    [][]any
}

func (r *fakeDatabaseRows) Close() error               { return nil }
func (r *fakeDatabaseRows) Columns() ([]string, error) { return r.columns, nil }
func (r *fakeDatabaseRows) Err() error                 { return r.err }
func (r *fakeDatabaseRows) Next() bool {
	if r.current+1 >= len(r.rows) {
		return false
	}
	r.current++
	return true
}
func (r *fakeDatabaseRows) Scan(destinations ...any) error {
	if r.current < 0 || r.current >= len(r.rows) {
		return fmt.Errorf("no current row")
	}
	if len(destinations) != len(r.rows[r.current]) {
		return fmt.Errorf("destination count mismatch")
	}
	for index := range destinations {
		value, ok := destinations[index].(*any)
		if !ok {
			return fmt.Errorf("destination %d is not *any", index)
		}
		*value = r.rows[r.current][index]
	}
	return nil
}

func TestCollectDatabaseRowsReturnsAtMostOneHundredRows(t *testing.T) {
	rows := make([][]any, maxDatabaseResultRows+1)
	for index := range rows {
		rows[index] = []any{int64(index)}
	}
	result, err := collectDatabaseRows(&fakeDatabaseRows{
		columns: []string{"id"},
		current: -1,
		rows:    rows,
	})
	if err != nil {
		t.Fatalf("collectDatabaseRows() error = %v", err)
	}
	if result.RowCount != maxDatabaseResultRows || len(result.Rows) != maxDatabaseResultRows || !result.Truncated {
		t.Fatalf("result rows/count/truncated = %d/%d/%v", len(result.Rows), result.RowCount, result.Truncated)
	}
}

func TestCollectDatabaseRowsRejectsOversizedValue(t *testing.T) {
	_, err := collectDatabaseRows(&fakeDatabaseRows{
		columns: []string{"payload"},
		current: -1,
		rows:    [][]any{{strings.Repeat("x", maxDatabaseResultBytes+1)}},
	})
	if err == nil || !strings.Contains(err.Error(), "select fewer columns or smaller values") {
		t.Fatalf("collectDatabaseRows() error = %v, want result size rejection", err)
	}
}

func TestDatabaseQuerySchemasDoNotExposeAuthorizationOrLimits(t *testing.T) {
	tools, err := NewSource().ListTools(context.Background())
	if err != nil {
		t.Fatalf("ListTools() error = %v", err)
	}
	for _, tool := range tools {
		if tool.Name != mysqlQueryToolName && tool.Name != postgresQueryToolName {
			continue
		}
		schema := tool.InputSchema.(map[string]any)
		properties := schema["properties"].(map[string]any)
		for _, forbidden := range []string{"authorization_ref", "params", "max_rows", "timeout_seconds"} {
			if _, ok := properties[forbidden]; ok {
				t.Fatalf("%s schema exposes %s: %#v", tool.Name, forbidden, schema)
			}
		}
	}
}
