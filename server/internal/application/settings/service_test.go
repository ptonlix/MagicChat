package settings

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"app/internal/store"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func TestServiceCreatesDefaultsAndUpdatesSettings(t *testing.T) {
	db := openSettingsTestDB(t)
	now := time.Date(2026, 7, 15, 8, 0, 0, 0, time.UTC)
	service := NewService(Dependencies{DB: db, Now: func() time.Time { return now }})

	value, err := service.Get(context.Background())
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	if value.AppName != store.DefaultAppName || value.OrganizationName != store.DefaultOrganizationName {
		t.Fatalf("default settings = %#v", value)
	}

	updated, err := service.Update(context.Background(), UpdateCommand{
		AppName:          "  星环协作  ",
		OrganizationName: " 长亭科技企业安全 ",
	})
	if err != nil {
		t.Fatalf("update settings: %v", err)
	}
	if updated.AppName != "星环协作" || updated.OrganizationName != "长亭科技企业安全" {
		t.Fatalf("updated settings = %#v", updated)
	}

	var stored store.AppSettings
	if err := db.First(&stored, "id = ?", store.AppSettingsID).Error; err != nil {
		t.Fatalf("load stored settings: %v", err)
	}
	if stored.AppName != updated.AppName || stored.OrganizationName != updated.OrganizationName || !stored.UpdatedAt.Equal(now) {
		t.Fatalf("stored settings = %#v", stored)
	}

	if _, err := service.Update(context.Background(), UpdateCommand{OrganizationName: "长亭科技"}); ErrorCodeOf(err) != CodeInvalidRequest {
		t.Fatalf("empty app name error = %v, code = %q", err, ErrorCodeOf(err))
	}
}

func TestServiceReturnsEnabledPublicProvidersInDisplayOrder(t *testing.T) {
	db := openSettingsTestDB(t)
	service := NewService(Dependencies{DB: db})
	providers := []store.ThirdPartyLoginProvider{
		newSettingsTestProvider("disabled", "Disabled", false, 0),
		newSettingsTestProvider("zeta", "Zeta", true, 2),
		newSettingsTestProvider("beta", "Beta", true, 1),
		newSettingsTestProvider("alpha", "Alpha", true, 1),
	}
	if err := db.Create(&providers).Error; err != nil {
		t.Fatalf("create providers: %v", err)
	}

	info, err := service.GetPublicInfo(context.Background())
	if err != nil {
		t.Fatalf("get public info: %v", err)
	}
	if len(info.Providers) != 3 || info.Providers[0].Key != "alpha" || info.Providers[1].Key != "beta" || info.Providers[2].Key != "zeta" {
		t.Fatalf("providers = %#v", info.Providers)
	}
}

func openSettingsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	if err := db.AutoMigrate(&store.AppSettings{}, &store.ThirdPartyLoginProvider{}); err != nil {
		t.Fatalf("migrate database: %v", err)
	}
	return db
}

func newSettingsTestProvider(key, name string, enabled bool, sortOrder int) store.ThirdPartyLoginProvider {
	now := time.Date(2026, 7, 15, 8, 0, 0, 0, time.UTC)
	return store.ThirdPartyLoginProvider{
		ID:           uuid.NewString(),
		Name:         name,
		Key:          key,
		Type:         "oidc",
		Enabled:      enabled,
		ClientID:     "client-id",
		ClientSecret: "client-secret",
		Scopes:       json.RawMessage(`[]`),
		Config:       json.RawMessage(`{}`),
		SortOrder:    sortOrder,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
}
