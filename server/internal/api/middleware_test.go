package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"mind_trace/server/internal/config"
	"mind_trace/server/internal/service"

	"github.com/gin-gonic/gin"
)

func TestAuthMiddlewareRequiresBearerAndRole(t *testing.T) {
	gin.SetMode(gin.TestMode)
	auth := service.NewAuthService(nil, config.Config{JWTSecret: []byte("middleware-test-secret-at-least-32-bytes"), JWTTTL: time.Hour})
	router := gin.New()
	router.GET("/admin", Auth(auth, nil, "admin"), func(c *gin.Context) { c.Status(http.StatusNoContent) })
	adminToken, err := auth.Token(1, "admin")
	if err != nil {
		t.Fatal(err)
	}
	userToken, err := auth.Token(2, "user")
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name, authorization string
		status              int
	}{
		{name: "missing", status: http.StatusUnauthorized},
		{name: "malformed", authorization: userToken, status: http.StatusUnauthorized},
		{name: "wrong role", authorization: "Bearer " + userToken, status: http.StatusUnauthorized},
		{name: "valid", authorization: "Bearer " + adminToken, status: http.StatusNoContent},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/admin", nil)
			request.Header.Set("Authorization", test.authorization)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != test.status {
				t.Fatalf("status=%d body=%s, want %d", response.Code, response.Body.String(), test.status)
			}
		})
	}
}
