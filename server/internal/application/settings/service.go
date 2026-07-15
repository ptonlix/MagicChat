package settings

import (
	"context"
	"errors"
	"strings"
	"time"

	"app/internal/store"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Dependencies struct {
	DB  *gorm.DB
	Now func() time.Time
}

type Service struct {
	db  *gorm.DB
	now func() time.Time
}

func NewService(deps Dependencies) *Service {
	now := deps.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{db: deps.DB, now: now}
}

func (s *Service) Get(ctx context.Context) (Settings, error) {
	value, err := s.getOrCreate(ctx)
	if err != nil {
		return Settings{}, internalError(err)
	}
	return newSettings(value), nil
}

func (s *Service) Update(ctx context.Context, cmd UpdateCommand) (Settings, error) {
	appName := strings.TrimSpace(cmd.AppName)
	if appName == "" {
		return Settings{}, newError(CodeInvalidRequest, "App 名称不能为空", nil)
	}
	organizationName := strings.TrimSpace(cmd.OrganizationName)
	if organizationName == "" {
		return Settings{}, newError(CodeInvalidRequest, "组织名称不能为空", nil)
	}

	if _, err := s.getOrCreate(ctx); err != nil {
		return Settings{}, internalError(err)
	}
	if err := s.db.WithContext(ctx).Model(&store.AppSettings{}).
		Where("id = ?", store.AppSettingsID).
		Updates(map[string]any{
			"app_name":          appName,
			"organization_name": organizationName,
			"updated_at":        s.now().UTC(),
		}).Error; err != nil {
		return Settings{}, internalError(err)
	}
	return Settings{AppName: appName, OrganizationName: organizationName}, nil
}

func (s *Service) GetPublicInfo(ctx context.Context) (PublicInfo, error) {
	value, err := s.Get(ctx)
	if err != nil {
		return PublicInfo{}, err
	}
	var providers []store.ThirdPartyLoginProvider
	if err := s.db.WithContext(ctx).
		Where("enabled = ?", true).
		Order("sort_order ASC").
		Order("name ASC").
		Find(&providers).Error; err != nil {
		return PublicInfo{}, internalError(err)
	}
	result := make([]PublicProvider, 0, len(providers))
	for _, provider := range providers {
		result = append(result, PublicProvider{Key: provider.Key, Name: provider.Name})
	}
	return PublicInfo{Settings: value, Providers: result}, nil
}

func (s *Service) getOrCreate(ctx context.Context) (store.AppSettings, error) {
	var value store.AppSettings
	err := s.db.WithContext(ctx).First(&value, "id = ?", store.AppSettingsID).Error
	if err == nil {
		return value, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return store.AppSettings{}, err
	}

	now := s.now().UTC()
	defaults := store.AppSettings{
		ID:               store.AppSettingsID,
		AppName:          store.DefaultAppName,
		OrganizationName: store.DefaultOrganizationName,
		CreatedAt:        now,
		UpdatedAt:        now,
	}
	if err := s.db.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&defaults).Error; err != nil {
		return store.AppSettings{}, err
	}
	if err := s.db.WithContext(ctx).First(&value, "id = ?", store.AppSettingsID).Error; err != nil {
		return store.AppSettings{}, err
	}
	return value, nil
}

func newSettings(value store.AppSettings) Settings {
	return Settings{AppName: value.AppName, OrganizationName: value.OrganizationName}
}

var _ AdminService = (*Service)(nil)
var _ PublicService = (*Service)(nil)
