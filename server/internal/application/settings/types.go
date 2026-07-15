package settings

import "context"

type Settings struct {
	AppName          string
	OrganizationName string
}

type PublicProvider struct {
	Key  string
	Name string
}

type PublicInfo struct {
	Settings  Settings
	Providers []PublicProvider
}

type UpdateCommand struct {
	AppName          string
	OrganizationName string
}

type AdminService interface {
	Get(context.Context) (Settings, error)
	Update(context.Context, UpdateCommand) (Settings, error)
}

type PublicService interface {
	GetPublicInfo(context.Context) (PublicInfo, error)
}
