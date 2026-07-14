package networktools

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"assistant/internal/mcpclient"
	"assistant/internal/publicnet"
)

const (
	databaseQueryTimeout   = 10 * time.Second
	maxDatabaseQueryBytes  = 100 * 1024
	maxDatabaseResultRows  = 100
	maxDatabaseResultBytes = 1024 * 1024
	databaseResultOverhead = 256
)

type databaseConnectionInput struct {
	Database string `json:"database"`
	Host     string `json:"host"`
	Password string `json:"password"`
	Port     int    `json:"port"`
	TLSMode  string `json:"tls_mode"`
	Username string `json:"username"`
}

type databaseQueryInput struct {
	Connection databaseConnectionInput `json:"connection"`
	Query      string                  `json:"query"`
}

type databaseQueryResult struct {
	Columns   []string `json:"columns"`
	Rows      [][]any  `json:"rows"`
	RowCount  int      `json:"row_count"`
	Truncated bool     `json:"truncated"`
}

type databaseQueryFunc func(context.Context, *publicnet.Guard, databaseQueryInput) (databaseQueryResult, error)

func (s *Source) callDatabaseQuery(
	ctx context.Context,
	raw json.RawMessage,
	defaultPort int,
	run databaseQueryFunc,
) (mcpclient.ToolResult, error) {
	if run == nil {
		return mcpclient.ToolResult{}, fmt.Errorf("database query tool is not configured")
	}
	var input databaseQueryInput
	if err := decodeStrictJSON(raw, &input); err != nil {
		return mcpclient.ToolResult{}, fmt.Errorf("parse database query input: %w", err)
	}
	if err := normalizeDatabaseInput(&input, defaultPort); err != nil {
		return mcpclient.ToolResult{}, err
	}
	queryCtx, cancel := context.WithTimeout(ctx, databaseQueryTimeout)
	defer cancel()
	if err := s.guard.ValidateHost(queryCtx, input.Connection.Host); err != nil {
		return mcpclient.ToolResult{}, err
	}
	if err := validateReadOnlyQuery(input.Query); err != nil {
		return mcpclient.ToolResult{}, err
	}

	result, err := run(queryCtx, s.guard, input)
	if err != nil {
		return mcpclient.ToolResult{}, err
	}
	return jsonResult(result)
}

func normalizeDatabaseInput(input *databaseQueryInput, defaultPort int) error {
	input.Connection.Host = strings.TrimSpace(input.Connection.Host)
	input.Connection.Database = strings.TrimSpace(input.Connection.Database)
	input.Connection.Username = strings.TrimSpace(input.Connection.Username)
	input.Connection.TLSMode = strings.ToLower(strings.TrimSpace(input.Connection.TLSMode))
	input.Query = strings.TrimSpace(input.Query)

	if input.Connection.Host == "" || len(input.Connection.Host) > 253 || strings.ContainsAny(input.Connection.Host, "/\\\x00\r\n") {
		return fmt.Errorf("database host is invalid")
	}
	if input.Connection.Port == 0 {
		input.Connection.Port = defaultPort
	}
	if input.Connection.Port < 1 || input.Connection.Port > 65535 {
		return fmt.Errorf("database port is invalid")
	}
	if input.Connection.Database == "" || len(input.Connection.Database) > 255 || strings.ContainsAny(input.Connection.Database, "\x00\r\n/") {
		return fmt.Errorf("database name is invalid")
	}
	if input.Connection.Username == "" || len(input.Connection.Username) > 255 || strings.ContainsRune(input.Connection.Username, '\x00') {
		return fmt.Errorf("database username is invalid")
	}
	if len(input.Connection.Password) > 4096 || strings.ContainsRune(input.Connection.Password, '\x00') {
		return fmt.Errorf("database password is invalid")
	}
	if input.Connection.TLSMode == "" {
		input.Connection.TLSMode = "verify-full"
	}
	if input.Connection.TLSMode != "verify-full" && input.Connection.TLSMode != "disable" {
		return fmt.Errorf("database tls_mode must be verify-full or disable")
	}
	if input.Query == "" || len([]byte(input.Query)) > maxDatabaseQueryBytes || !utf8.ValidString(input.Query) || strings.ContainsRune(input.Query, '\x00') {
		return fmt.Errorf("database query is required, must be valid UTF-8, and must not exceed %d bytes", maxDatabaseQueryBytes)
	}
	return nil
}

func validateReadOnlyQuery(query string) error {
	if !isSingleSQLStatement(query) {
		return fmt.Errorf("database query must contain exactly one statement")
	}
	if containsExecutableSQLComment(query) {
		return fmt.Errorf("database query must not contain executable comments")
	}
	keyword := firstSQLKeyword(query)
	switch keyword {
	case "select", "show", "describe", "desc":
	case "with":
		for _, word := range sqlWords(query) {
			switch word {
			case "insert", "update", "delete", "merge", "replace":
				return fmt.Errorf("database query must be read-only")
			}
		}
	case "explain":
		for _, word := range sqlWords(query) {
			switch word {
			case "insert", "update", "delete", "merge", "replace", "create", "execute", "declare", "refresh", "call", "copy":
				return fmt.Errorf("database query must be read-only")
			}
		}
	default:
		return fmt.Errorf("database query must be read-only")
	}
	words := sqlWords(query)
	for index := 0; index+1 < len(words); index++ {
		if words[index] == "into" && (words[index+1] == "outfile" || words[index+1] == "dumpfile") {
			return fmt.Errorf("database query must not write files")
		}
	}
	return nil
}

func firstSQLKeyword(query string) string {
	index := skipSQLSpaceAndComments(query, 0)
	start := index
	for index < len(query) {
		character := rune(query[index])
		if character > unicode.MaxASCII || !unicode.IsLetter(character) {
			break
		}
		index++
	}
	return strings.ToLower(query[start:index])
}

func isSingleSQLStatement(query string) bool {
	semicolon := findSQLSemicolon(query)
	if semicolon < 0 {
		return firstSQLKeyword(query) != ""
	}
	return firstSQLKeyword(query) != "" && skipSQLSpaceAndComments(query, semicolon+1) == len(query)
}

func findSQLSemicolon(query string) int {
	for index := 0; index < len(query); {
		switch query[index] {
		case '\'', '"', '`':
			index = skipSQLQuoted(query, index, query[index])
		case '-':
			if isSQLDashCommentStart(query, index) {
				index = skipSQLLineComment(query, index+2)
			} else {
				index++
			}
		case '#':
			index = skipSQLLineComment(query, index+1)
		case '/':
			if index+1 < len(query) && query[index+1] == '*' {
				index = skipSQLBlockComment(query, index+2)
			} else {
				index++
			}
		case '$':
			if end := skipPostgreSQLDollarQuote(query, index); end > index {
				index = end
			} else {
				index++
			}
		case ';':
			return index
		default:
			index++
		}
	}
	return -1
}

func skipSQLSpaceAndComments(query string, start int) int {
	index := start
	for index < len(query) {
		if query[index] == ' ' || query[index] == '\t' || query[index] == '\r' || query[index] == '\n' {
			index++
			continue
		}
		if isSQLDashCommentStart(query, index) {
			index = skipSQLLineComment(query, index+2)
			continue
		}
		if query[index] == '#' {
			index = skipSQLLineComment(query, index+1)
			continue
		}
		if index+1 < len(query) && query[index] == '/' && query[index+1] == '*' {
			index = skipSQLBlockComment(query, index+2)
			continue
		}
		break
	}
	return index
}

func skipSQLQuoted(query string, start int, quote byte) int {
	for index := start + 1; index < len(query); index++ {
		if query[index] == '\\' {
			index++
			continue
		}
		if query[index] != quote {
			continue
		}
		if index+1 < len(query) && query[index+1] == quote {
			index++
			continue
		}
		return index + 1
	}
	return len(query)
}

func skipSQLLineComment(query string, start int) int {
	if end := strings.IndexByte(query[start:], '\n'); end >= 0 {
		return start + end + 1
	}
	return len(query)
}

func isSQLDashCommentStart(query string, index int) bool {
	if index < 0 || index+1 >= len(query) || query[index] != '-' || query[index+1] != '-' {
		return false
	}
	return index+2 == len(query) || query[index+2] <= ' '
}

func skipSQLBlockComment(query string, start int) int {
	depth := 1
	for index := start; index < len(query)-1; index++ {
		if query[index] == '/' && query[index+1] == '*' {
			depth++
			index++
			continue
		}
		if query[index] == '*' && query[index+1] == '/' {
			depth--
			index++
			if depth == 0 {
				return index + 1
			}
		}
	}
	return len(query)
}

func skipPostgreSQLDollarQuote(query string, start int) int {
	endTag := start + 1
	if endTag < len(query) && query[endTag] != '$' && !isSQLIdentifierStartByte(query[endTag]) {
		return start
	}
	for endTag < len(query) && (isSQLIdentifierStartByte(query[endTag]) || query[endTag] >= '0' && query[endTag] <= '9') {
		endTag++
	}
	if endTag >= len(query) || query[endTag] != '$' {
		return start
	}
	tag := query[start : endTag+1]
	if closing := strings.Index(query[endTag+1:], tag); closing >= 0 {
		return endTag + 1 + closing + len(tag)
	}
	return len(query)
}

func containsExecutableSQLComment(query string) bool {
	for index := 0; index < len(query); {
		switch query[index] {
		case '\'', '"', '`':
			index = skipSQLQuoted(query, index, query[index])
		case '$':
			if end := skipPostgreSQLDollarQuote(query, index); end > index {
				index = end
			} else {
				index++
			}
		case '/':
			if index+2 < len(query) && query[index+1] == '*' {
				if query[index+2] == '!' ||
					(index+3 < len(query) && (query[index+2] == 'M' || query[index+2] == 'm') && query[index+3] == '!') {
					return true
				}
				index = skipSQLBlockComment(query, index+2)
			} else {
				index++
			}
		case '-':
			if isSQLDashCommentStart(query, index) {
				index = skipSQLLineComment(query, index+2)
			} else {
				index++
			}
		case '#':
			index = skipSQLLineComment(query, index+1)
		default:
			index++
		}
	}
	return false
}

func sqlWords(query string) []string {
	words := make([]string, 0, 16)
	for index := 0; index < len(query); {
		switch query[index] {
		case '\'', '"', '`':
			index = skipSQLQuoted(query, index, query[index])
		case '-':
			if isSQLDashCommentStart(query, index) {
				index = skipSQLLineComment(query, index+2)
			} else {
				index++
			}
		case '#':
			index = skipSQLLineComment(query, index+1)
		case '/':
			if index+1 < len(query) && query[index+1] == '*' {
				index = skipSQLBlockComment(query, index+2)
			} else {
				index++
			}
		case '$':
			if end := skipPostgreSQLDollarQuote(query, index); end > index {
				index = end
			} else {
				index++
			}
		default:
			if !isSQLWordByte(query[index]) {
				index++
				continue
			}
			start := index
			for index < len(query) && isSQLWordByte(query[index]) {
				index++
			}
			words = append(words, strings.ToLower(query[start:index]))
		}
	}
	return words
}

func isSQLWordByte(character byte) bool {
	return isSQLIdentifierStartByte(character) || character >= '0' && character <= '9'
}

func isSQLIdentifierStartByte(character byte) bool {
	return character == '_' || character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z'
}

type databaseRows interface {
	Close() error
	Columns() ([]string, error)
	Err() error
	Next() bool
	Scan(...any) error
}

func collectDatabaseRows(rows databaseRows) (databaseQueryResult, error) {
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return databaseQueryResult{}, err
	}
	encodedColumns, err := json.Marshal(columns)
	if err != nil {
		return databaseQueryResult{}, fmt.Errorf("encode database columns: %w", err)
	}
	resultBytes := len(encodedColumns) + databaseResultOverhead
	if resultBytes > maxDatabaseResultBytes {
		return databaseQueryResult{}, databaseResultTooLargeError()
	}
	result := databaseQueryResult{
		Columns: columns,
		Rows:    make([][]any, 0, min(maxDatabaseResultRows, 16)),
	}
	for rows.Next() {
		values := make([]any, len(columns))
		destinations := make([]any, len(columns))
		for index := range values {
			destinations[index] = &values[index]
		}
		if err := rows.Scan(destinations...); err != nil {
			return databaseQueryResult{}, err
		}
		if len(result.Rows) == maxDatabaseResultRows {
			result.Truncated = true
			break
		}
		for index, value := range values {
			values[index] = normalizeDatabaseValue(value)
		}
		if databaseRowRawBytes(values) > maxDatabaseResultBytes {
			return databaseQueryResult{}, databaseResultTooLargeError()
		}
		encodedRow, err := json.Marshal(values)
		if err != nil {
			return databaseQueryResult{}, fmt.Errorf("encode database row: %w", err)
		}
		resultBytes += len(encodedRow) + 1
		if resultBytes > maxDatabaseResultBytes {
			return databaseQueryResult{}, databaseResultTooLargeError()
		}
		result.Rows = append(result.Rows, values)
	}
	if err := rows.Err(); err != nil {
		return databaseQueryResult{}, err
	}
	result.RowCount = len(result.Rows)
	return result, nil
}

func databaseRowRawBytes(values []any) int {
	total := 0
	for _, value := range values {
		switch typed := value.(type) {
		case string:
			total += len(typed)
		case []byte:
			total += len(typed)
		}
		if total > maxDatabaseResultBytes {
			return total
		}
	}
	return total
}

func databaseResultTooLargeError() error {
	return fmt.Errorf("database query result exceeds %d bytes; select fewer columns or smaller values", maxDatabaseResultBytes)
}

func normalizeDatabaseValue(value any) any {
	switch typed := value.(type) {
	case []byte:
		return string(typed)
	case time.Time:
		return typed.UTC().Format(time.RFC3339Nano)
	default:
		return value
	}
}

func databaseAddress(connection databaseConnectionInput) string {
	return net.JoinHostPort(connection.Host, fmt.Sprintf("%d", connection.Port))
}

func databaseQueryInputSchema(defaultPort int) map[string]any {
	return map[string]any{
		"type":     "object",
		"required": []string{"connection", "query"},
		"properties": map[string]any{
			"connection": map[string]any{
				"type":     "object",
				"required": []string{"host", "database", "username", "password"},
				"properties": map[string]any{
					"host":     map[string]any{"type": "string", "minLength": 1, "maxLength": 253},
					"port":     map[string]any{"type": "integer", "minimum": 1, "maximum": 65535, "default": defaultPort},
					"database": map[string]any{"type": "string", "minLength": 1, "maxLength": 255},
					"username": map[string]any{"type": "string", "minLength": 1, "maxLength": 255},
					"password": map[string]any{"type": "string", "maxLength": 4096},
					"tls_mode": map[string]any{"type": "string", "enum": []string{"verify-full", "disable"}, "default": "verify-full"},
				},
				"additionalProperties": false,
			},
			"query": map[string]any{"type": "string", "minLength": 1, "maxLength": maxDatabaseQueryBytes},
		},
		"additionalProperties": false,
	}
}
