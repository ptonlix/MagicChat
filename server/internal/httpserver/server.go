package httpserver

import (
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	adminapi "app/internal/api/http/admin"
	clientapi "app/internal/api/http/client"
	"app/internal/appconnection"
	"app/internal/application/account"
	fileapp "app/internal/application/file"
	projectapp "app/internal/application/project"
	settingsapp "app/internal/application/settings"
	taskapp "app/internal/application/task"
	"app/internal/config"
	"app/internal/infrastructure/filestorage"
	"app/internal/realtime"
	"app/internal/store"

	"github.com/labstack/echo/v4"
	echoSwagger "github.com/swaggo/echo-swagger"
	"gorm.io/gorm"
)

const (
	adminSessionCookieName = "admin_session"
	userSessionCookieName  = clientapi.UserSessionCookieName
	sessionTTL             = 7 * 24 * time.Hour
)

type Server struct {
	db             *gorm.DB
	cfg            config.Config
	accounts       *account.Service
	clientAccounts *clientapi.AccountAPI
	files          *fileapp.Service
	clientFiles    *clientapi.FileAPI
	settings       *settingsapp.Service
	clientInfo     *clientapi.InfoAPI
	adminSettings  *adminapi.SettingsAPI
	projects       *projectapp.Service
	clientProjects *clientapi.ProjectAPI
	tasks          *taskapp.Service
	clientTasks    *clientapi.TaskAPI
	appConnections *appconnection.Manager
	realtime       *realtime.ConnectionPool
	appEventMu     sync.Mutex

	beforeAppEventLock     func(store.Message)
	afterUserMessageCommit func(store.Message)
}

func NewRouter(db *gorm.DB, cfg config.Config) *echo.Echo {
	return NewRouterWithRealtimeOptions(db, cfg, realtime.Options{})
}

func NewRouterWithRealtimeOptions(db *gorm.DB, cfg config.Config, realtimeOptions realtime.Options) *echo.Echo {
	server := &Server{
		db:  db,
		cfg: cfg,
	}
	server.files = fileapp.NewService(fileapp.Dependencies{
		DB:                  db,
		Storage:             filestorage.New(cfg.Storage),
		TemporaryExpireDays: cfg.Storage.Lifecycle.TemporaryExpireDays,
	})
	server.clientFiles = clientapi.NewFileAPI(server.files)
	server.settings = settingsapp.NewService(settingsapp.Dependencies{DB: db})
	server.adminSettings = adminapi.NewSettingsAPI(server.settings)
	server.accounts = account.NewService(account.Dependencies{
		DB:    db,
		Files: server.files,
	})
	server.clientAccounts = clientapi.NewAccountAPI(
		server.accounts,
		server.accounts,
		func(c echo.Context, session account.AuthenticatedSession) {
			c.Set(currentUserContextKey, legacyUserFromAccount(session.Account))
		},
	)
	server.clientInfo = clientapi.NewInfoAPI(server.settings, server.accounts)
	server.projects = projectapp.NewService(projectapp.Dependencies{
		DB:    db,
		Files: server.files,
	})
	server.clientProjects = clientapi.NewProjectAPI(server.projects)
	server.tasks = taskapp.NewService(taskapp.Dependencies{
		DB:            db,
		Notifications: server,
	})
	server.clientTasks = clientapi.NewTaskAPI(server.tasks)
	server.appConnections = appconnection.NewManager(appconnection.Options{
		RequestHandler: server.handleAppRequest,
	})
	realtimeOptions.RecordUserPong = server.recordUserPong
	server.realtime = realtime.NewConnectionPool(realtimeOptions)

	router := echo.New()
	router.HideBanner = true
	router.HidePort = true

	router.GET("/healthz", func(c echo.Context) error {
		return success(c, http.StatusOK, map[string]any{"status": "ok"})
	})
	if docsDir, ok := findAPIDocsDir(); ok {
		router.Static("/api-docs", docsDir)
		router.GET("/swagger/*", echoSwagger.EchoWrapHandler(echoSwagger.URL("/api-docs/swagger.json")))
	}
	router.POST("/api/admin/auth/login", server.adminLogin)
	server.clientAccounts.RegisterPublicRoutes(router)
	router.GET("/api/client/auth/third-party/:key/start", server.startThirdPartyLogin)
	router.GET("/api/client/auth/third-party/:key/callback", server.finishThirdPartyLogin)
	server.clientInfo.RegisterPublicRoutes(router)
	router.GET("/api/app/ws", server.appWebSocket)

	client := router.Group("/api/client", server.clientAccounts.RequireSession)
	server.clientAccounts.RegisterProtectedRoutes(client)
	server.clientFiles.RegisterRoutes(client)
	server.clientProjects.RegisterRoutes(client)
	server.clientTasks.RegisterRoutes(client)
	client.GET("/contacts", server.listClientContacts)
	client.GET("/contacts/users", server.listContactUsers)
	client.GET("/conversations", server.listClientConversations)
	client.POST("/conversations/apps", server.createAppConversation)
	client.POST("/conversations/direct", server.createDirectConversation)
	client.POST("/conversations/groups", server.createGroupConversation)
	client.PATCH("/conversations/groups/:conversation_id/name", server.updateGroupConversationName)
	client.POST("/conversations/groups/:conversation_id/public", server.setGroupConversationPublic)
	client.POST("/conversations/groups/:conversation_id/private", server.setGroupConversationPrivate)
	client.POST("/conversations/groups/:conversation_id/join", server.joinPublicGroupConversation)
	client.POST("/conversations/groups/:conversation_id/leave", server.leaveGroupConversation)
	client.DELETE("/conversations/groups/:conversation_id", server.dissolveGroupConversation)
	client.DELETE("/conversations/groups/:conversation_id/members/:member_type/:member_id", server.removeTypedGroupConversationMember)
	client.DELETE("/conversations/groups/:conversation_id/members/:member_id", server.removeGroupConversationMember)
	client.POST("/conversations/:conversation_id/avatar", server.uploadGroupConversationAvatar)
	client.PUT("/conversations/:conversation_id/projects/:project_id", server.bindGroupConversationProject)
	client.DELETE("/conversations/:conversation_id/projects/:project_id", server.unbindGroupConversationProject)
	client.POST("/conversations/:conversation_id/members", server.addGroupConversationMembers)
	client.POST("/conversations/:conversation_id/read", server.markConversationRead)
	client.GET("/conversations/:conversation_id/messages", server.listConversationMessages)
	client.POST("/conversations/:conversation_id/messages", server.createConversationMessage)
	client.POST("/conversations/:conversation_id/messages/forward", server.forwardConversationMessages)
	client.POST("/conversations/:conversation_id/messages/files", server.createConversationFileMessage)
	client.POST("/conversations/:conversation_id/messages/images", server.createConversationImageMessage)
	client.POST("/conversations/:conversation_id/messages/voices", server.createConversationVoiceMessage)
	client.POST("/conversations/:conversation_id/messages/:message_id/revoke", server.revokeConversationMessage)
	client.GET("/ws", server.clientWebSocket)

	admin := router.Group("/api/admin", server.requireAdminSession)
	server.adminSettings.RegisterRoutes(admin)
	admin.GET("/apps", server.listAdminApps)
	admin.POST("/apps", server.createAdminApp)
	admin.PUT("/apps/:id", server.updateAdminApp)
	admin.POST("/apps/:id/avatar", server.uploadAdminAppAvatar)
	admin.POST("/apps/:id/enable", server.enableAdminApp)
	admin.POST("/apps/:id/disable", server.disableAdminApp)
	admin.POST("/apps/:id/secret/regenerate", server.regenerateAdminAppSecret)
	admin.DELETE("/apps/:id", server.deleteAdminApp)
	admin.GET("/third-party/providers", server.listThirdPartyProviders)
	admin.POST("/third-party/providers", server.createThirdPartyProvider)
	admin.PUT("/third-party/providers/:id", server.updateThirdPartyProvider)
	admin.POST("/third-party/providers/:id/enable", server.enableThirdPartyProvider)
	admin.POST("/third-party/providers/:id/disable", server.disableThirdPartyProvider)
	admin.POST("/third-party/providers/:id/move", server.moveThirdPartyProvider)
	admin.DELETE("/third-party/providers/:id", server.deleteThirdPartyProvider)
	admin.GET("/users", server.listUsers)
	admin.POST("/users", server.createUser)
	admin.POST("/users/:id/disable", server.disableUser)
	admin.POST("/users/:id/enable", server.enableUser)
	admin.POST("/users/:id/reset-password", server.resetUserPassword)

	return router
}

func legacyUserFromAccount(value account.Account) store.User {
	var phone *string
	if value.Phone != "" {
		phoneValue := value.Phone
		phone = &phoneValue
	}
	return store.User{
		ID:           value.ID,
		Email:        value.Email,
		Name:         value.Name,
		Nickname:     value.Nickname,
		Phone:        phone,
		Avatar:       value.Avatar,
		Status:       value.Status,
		LastOnlineAt: value.LastOnlineAt,
		CreatedAt:    value.CreatedAt,
		UpdatedAt:    value.UpdatedAt,
	}
}

func findAPIDocsDir() (string, bool) {
	return findDirContaining("api-docs", "swagger.json")
}

func findDirContaining(relativeDir string, requiredFile string) (string, bool) {
	dir, err := os.Getwd()
	if err != nil {
		return "", false
	}

	for {
		candidate := filepath.Join(dir, relativeDir)
		statPath := candidate
		if requiredFile != "" {
			statPath = filepath.Join(candidate, requiredFile)
		}
		if _, err := os.Stat(statPath); err == nil {
			return candidate, true
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}
