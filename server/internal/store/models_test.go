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
		{name: "third-party provider", model: ThirdPartyLoginProvider{}, table: "third_party_login_providers"},
		{name: "third-party login state", model: ThirdPartyLoginState{}, table: "third_party_login_states"},
		{name: "third-party account", model: ThirdPartyAccount{}, table: "third_party_accounts"},
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
