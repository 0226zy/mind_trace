package api

import (
	"net/http"
	"strings"

	"mind_trace/server/internal/models"
	"mind_trace/server/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const UserIDKey = "authUserID"

func Auth(auth *service.AuthService, db *gorm.DB, role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		parts := strings.SplitN(c.GetHeader("Authorization"), " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
			Error(c, Unauthorized("missing bearer token"))
			c.Abort()
			return
		}
		id, err := auth.ParseToken(strings.TrimSpace(parts[1]), role)
		if err != nil {
			Error(c, err)
			c.Abort()
			return
		}
		if role == "user" {
			var count int64
			if err := db.Model(&models.User{}).Where("id = ?", id).Count(&count).Error; err != nil {
				Error(c, err)
				c.Abort()
				return
			}
			if count != 1 {
				Error(c, Unauthorized("user no longer exists"))
				c.Abort()
				return
			}
		}
		c.Set(UserIDKey, id)
		c.Next()
	}
}

func UserID(c *gin.Context) uint64 {
	value, _ := c.Get(UserIDKey)
	id, _ := value.(uint64)
	return id
}

func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Cache-Control", "no-store")
		c.Next()
	}
}

func CORS(allowed string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if allowed == "*" {
			c.Header("Access-Control-Allow-Origin", "*")
		} else {
			for _, item := range strings.Split(allowed, ",") {
				if origin != "" && strings.TrimSpace(item) == origin {
					c.Header("Access-Control-Allow-Origin", origin)
					c.Header("Vary", "Origin")
					break
				}
			}
		}
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
