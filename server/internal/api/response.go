package api

import (
	"errors"
	"log"
	"net/http"

	"mind_trace/server/internal/apperr"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type AppError = apperr.AppError

var BadRequest = apperr.BadRequest
var Unauthorized = apperr.Unauthorized
var NotFound = apperr.NotFound
var Conflict = apperr.Conflict

func Data(c *gin.Context, status int, data any) { c.JSON(status, gin.H{"data": data}) }

func Error(c *gin.Context, err error) {
	var appErr *AppError
	if errors.As(err, &appErr) {
		c.JSON(appErr.Status, gin.H{"error": gin.H{"code": appErr.Code, "message": appErr.Message}})
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		NotFoundResponse(c)
		return
	}
	log.Printf("request failed: %v", err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": gin.H{"code": "INTERNAL_ERROR", "message": "internal server error"}})
}

func NotFoundResponse(c *gin.Context) {
	c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"code": "NOT_FOUND", "message": "resource not found"}})
}
