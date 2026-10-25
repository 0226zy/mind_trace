package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	Port           string
	AppEnv         string
	MySQLDSN       string
	JWTSecret      []byte
	JWTTTL         time.Duration
	AuthDevMode    bool
	WechatAppID    string
	WechatSecret   string
	WechatAPIURL   string
	AdminUsername  string
	AdminPassword  string
	AllowedOrigins string
}

func Load() (Config, error) {
	cfg := Config{
		Port:           getEnv("PORT", "8080"),
		AppEnv:         getEnv("APP_ENV", "development"),
		MySQLDSN:       os.Getenv("MYSQL_DSN"),
		JWTSecret:      []byte(os.Getenv("JWT_SECRET")),
		AuthDevMode:    os.Getenv("AUTH_DEV_MODE") == "true",
		WechatAppID:    os.Getenv("WECHAT_APP_ID"),
		WechatSecret:   os.Getenv("WECHAT_APP_SECRET"),
		WechatAPIURL:   getEnv("WECHAT_API_URL", "https://api.weixin.qq.com/sns/jscode2session"),
		AdminUsername:  os.Getenv("ADMIN_USERNAME"),
		AdminPassword:  os.Getenv("ADMIN_PASSWORD"),
		AllowedOrigins: getEnv("ALLOWED_ORIGINS", "*"),
	}
	ttlHours, err := strconv.Atoi(getEnv("JWT_TTL_HOURS", "168"))
	if err != nil || ttlHours < 1 || ttlHours > 720 {
		return Config{}, fmt.Errorf("JWT_TTL_HOURS must be between 1 and 720")
	}
	cfg.JWTTTL = time.Duration(ttlHours) * time.Hour
	if cfg.MySQLDSN == "" {
		return Config{}, fmt.Errorf("MYSQL_DSN is required")
	}
	if len(cfg.JWTSecret) < 32 {
		return Config{}, fmt.Errorf("JWT_SECRET must contain at least 32 bytes")
	}
	if cfg.AuthDevMode && cfg.AppEnv != "development" {
		return Config{}, fmt.Errorf("AUTH_DEV_MODE is only allowed when APP_ENV=development")
	}
	if !cfg.AuthDevMode && (cfg.WechatAppID == "" || cfg.WechatSecret == "") {
		return Config{}, fmt.Errorf("WECHAT_APP_ID and WECHAT_APP_SECRET are required when dev login is disabled")
	}
	if (cfg.AdminUsername == "") != (cfg.AdminPassword == "") {
		return Config{}, fmt.Errorf("ADMIN_USERNAME and ADMIN_PASSWORD must be configured together")
	}
	return cfg, nil
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
