package api

import (
	"net/http"

	"mind_trace/server/internal/config"
	"mind_trace/server/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func NewRouter(db *gorm.DB, cfg config.Config) *gin.Engine {
	router := gin.New()
	router.Use(gin.Recovery(), SecurityHeaders(), CORS(cfg.AllowedOrigins))
	auth := service.NewAuthService(db, cfg)
	handler := NewHandler(db, auth, service.NewRecordService(db), service.NewThoughtService(db), service.NewAdminService(db))
	health := func(c *gin.Context) { Data(c, http.StatusOK, gin.H{"status": "ok"}) }
	router.GET("/health", health)
	v1 := router.Group("/api/v1")
	v1.GET("/health", health)
	v1.POST("/auth/wechat/login", handler.WechatLogin)
	v1.POST("/admin/login", handler.AdminLogin)
	user := v1.Group("")
	user.Use(Auth(auth, db, "user"))
	user.GET("/me", handler.Me)
	user.DELETE("/me", handler.DeleteMe)
	user.GET("/dashboard", handler.Dashboard)
	user.POST("/thoughts/match", handler.Match)
	user.GET("/thoughts", handler.ListThoughts)
	user.GET("/thoughts/:id", handler.GetThought)
	user.POST("/records", handler.CreateRecord)
	user.GET("/records", handler.ListRecords)
	user.GET("/records/:id", handler.GetRecord)
	user.PATCH("/records/:id", handler.PatchRecord)
	user.POST("/records/:id/close", handler.CloseRecord)
	user.POST("/records/:id/pause", handler.PauseRecord)
	user.GET("/stats/summary", handler.Stats)
	admin := v1.Group("/admin")
	admin.Use(Auth(auth, db, "admin"))
	admin.GET("/overview", handler.AdminOverview)
	admin.GET("/users", handler.AdminUsers)
	router.NoRoute(func(c *gin.Context) { NotFoundResponse(c) })
	return router
}
