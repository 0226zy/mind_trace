package service

import (
	"context"
	"testing"
	"time"

	"mind_trace/server/internal/apperr"
	"mind_trace/server/internal/config"

	"github.com/golang-jwt/jwt/v5"
)

func authConfig() config.Config {
	return config.Config{AppEnv: "development", JWTSecret: []byte("test-secret-with-at-least-32-bytes"), JWTTTL: time.Hour, AdminUsername: "admin", AdminPassword: "correct-password"}
}

func TestTokenAuthenticationAndRoleIsolation(t *testing.T) {
	svc := NewAuthService(nil, authConfig())
	token, err := svc.Token(42, "user")
	if err != nil {
		t.Fatalf("create token: %v", err)
	}
	id, err := svc.ParseToken(token, "user")
	if err != nil || id != 42 {
		t.Fatalf("valid token rejected: id=%d err=%v", id, err)
	}
	if _, err := svc.ParseToken(token, "admin"); err == nil {
		t.Fatal("user token must not authenticate as admin")
	}
	if _, err := svc.ParseToken(token+"tampered", "user"); err == nil {
		t.Fatal("tampered token accepted")
	}
}

func TestTokenRejectsWrongSecretAndNoneAlgorithm(t *testing.T) {
	cfg := authConfig()
	svc := NewAuthService(nil, cfg)
	token, err := svc.Token(7, "user")
	if err != nil {
		t.Fatal(err)
	}
	other := NewAuthService(nil, config.Config{JWTSecret: []byte("another-secret-with-at-least-32-bytes")})
	if _, err := other.ParseToken(token, "user"); err == nil {
		t.Fatal("token signed by another secret accepted")
	}
	unsigned, err := jwt.NewWithClaims(jwt.SigningMethodNone, Claims{Role: "user", RegisteredClaims: jwt.RegisteredClaims{Subject: "7", ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}}).SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ParseToken(unsigned, "user"); err == nil {
		t.Fatal("unsigned token accepted")
	}
}

func TestTokenRejectsExpiration(t *testing.T) {
	cfg := authConfig()
	cfg.JWTTTL = -time.Hour
	svc := NewAuthService(nil, cfg)
	token, err := svc.Token(1, "user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ParseToken(token, "user"); err == nil {
		t.Fatal("expired token accepted")
	}
}

func TestDevCodeRequiresDevelopmentMode(t *testing.T) {
	for _, cfg := range []config.Config{
		{AppEnv: "development", AuthDevMode: false},
		{AppEnv: "production", AuthDevMode: true},
	} {
		svc := NewAuthService(nil, cfg)
		_, err := svc.WechatLogin(context.Background(), LoginInput{Code: "dev_test-user"})
		if err == nil {
			t.Fatalf("dev login accepted with config %+v", cfg)
		}
		if appErr, ok := err.(*apperr.AppError); !ok || appErr.Code != "UNAUTHORIZED" {
			t.Fatalf("unexpected error: %v", err)
		}
	}
}

func TestAdminLogin(t *testing.T) {
	svc := NewAuthService(nil, authConfig())
	if _, err := svc.AdminLogin("admin", "wrong"); err == nil {
		t.Fatal("wrong password accepted")
	}
	token, err := svc.AdminLogin("admin", "correct-password")
	if err != nil {
		t.Fatalf("valid admin credentials rejected: %v", err)
	}
	if _, err := svc.ParseToken(token, "user"); err == nil {
		t.Fatal("admin token accepted as user token")
	}
	if _, err := svc.ParseToken(token, "admin"); err != nil {
		t.Fatalf("admin token rejected: %v", err)
	}
}

func TestAdminLoginDisabledWithoutEnvironmentCredentials(t *testing.T) {
	svc := NewAuthService(nil, authConfig())
	svc.cfg.AdminUsername, svc.cfg.AdminPassword = "", ""
	if _, err := svc.AdminLogin("admin", "anything"); err == nil {
		t.Fatal("disabled admin login accepted credentials")
	}
}
