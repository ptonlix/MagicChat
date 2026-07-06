package store

import (
	"sync"
	"testing"

	"gorm.io/gorm/schema"
)

func TestModelTableNamesMatchInitialSchema(t *testing.T) {
	tests := []struct {
		name  string
		model any
		table string
	}{
		{name: "oidc provider", model: OIDCProvider{}, table: "oidc_providers"},
		{name: "oidc login state", model: OIDCLoginState{}, table: "oidc_login_states"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			parsedSchema, err := schema.Parse(test.model, &sync.Map{}, schema.NamingStrategy{})
			if err != nil {
				t.Fatalf("parse schema: %v", err)
			}
			if parsedSchema.Table != test.table {
				t.Fatalf("table = %q, want %q", parsedSchema.Table, test.table)
			}
		})
	}
}
