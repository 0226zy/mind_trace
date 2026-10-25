package service

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	api "mind_trace/server/internal/apperr"
	"mind_trace/server/internal/config"
	"mind_trace/server/internal/models"

	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"
)

type AuthService struct {
	db     *gorm.DB
	cfg    config.Config
	client *http.Client
}

func NewAuthService(db *gorm.DB, cfg config.Config) *AuthService {
	return &AuthService{db: db, cfg: cfg, client: &http.Client{Timeout: 8 * time.Second}}
}

type Claims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

func (s *AuthService) Token(subject uint64, role string) (string, error) {
	now := time.Now()
	claims := Claims{Role: role, RegisteredClaims: jwt.RegisteredClaims{
		Subject: strconv.FormatUint(subject, 10), IssuedAt: jwt.NewNumericDate(now), NotBefore: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(s.cfg.JWTTTL)),
	}}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.cfg.JWTSecret)
}

func (s *AuthService) ParseToken(raw, expectedRole string) (uint64, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return s.cfg.JWTSecret, nil
	})
	if err != nil || !token.Valid || claims.Role != expectedRole {
		return 0, api.Unauthorized("invalid or expired token")
	}
	id, err := strconv.ParseUint(claims.Subject, 10, 64)
	if err != nil || id == 0 {
		return 0, api.Unauthorized("invalid token subject")
	}
	return id, nil
}

type LoginInput struct {
	Code      string  `json:"code" binding:"required"`
	Nickname  *string `json:"nickname"`
	AvatarURL *string `json:"avatarUrl"`
}

type LoginResult struct {
	Token string      `json:"token"`
	User  models.User `json:"user"`
}

type wechatResponse struct {
	OpenID     string `json:"openid"`
	SessionKey string `json:"session_key"`
	UnionID    string `json:"unionid"`
	ErrCode    int    `json:"errcode"`
	ErrMsg     string `json:"errmsg"`
}

func (s *AuthService) WechatLogin(ctx context.Context, input LoginInput) (LoginResult, error) {
	input.Code = strings.TrimSpace(input.Code)
	if err := validateText("code", input.Code, 1, 256); err != nil {
		return LoginResult{}, err
	}
	if input.Nickname != nil {
		if err := validateText("nickname", *input.Nickname, 0, 100); err != nil {
			return LoginResult{}, err
		}
	}
	if input.AvatarURL != nil {
		if err := validateText("avatarUrl", *input.AvatarURL, 0, 1024); err != nil {
			return LoginResult{}, err
		}
	}
	var openID string
	if strings.HasPrefix(input.Code, "dev_") {
		if !s.cfg.AuthDevMode || s.cfg.AppEnv != "development" {
			return LoginResult{}, api.Unauthorized("development login is disabled")
		}
		if len(input.Code) < 5 {
			return LoginResult{}, api.BadRequest("invalid development code")
		}
		openID = "dev:" + strings.TrimPrefix(input.Code, "dev_")
	} else {
		var err error
		openID, err = s.exchangeCode(ctx, input.Code)
		if err != nil {
			return LoginResult{}, err
		}
	}
	if len(openID) == 0 || len(openID) > 64 {
		return LoginResult{}, api.Unauthorized("wechat login failed")
	}
	var user models.User
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Where("open_id = ?", openID).First(&user).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			user = models.User{OpenID: openID}
			if input.Nickname != nil {
				user.Nickname = strings.TrimSpace(*input.Nickname)
			}
			if input.AvatarURL != nil {
				user.AvatarURL = strings.TrimSpace(*input.AvatarURL)
			}
			return tx.Create(&user).Error
		}
		if err != nil {
			return err
		}
		updates := map[string]any{}
		if input.Nickname != nil {
			updates["nickname"] = strings.TrimSpace(*input.Nickname)
		}
		if input.AvatarURL != nil {
			updates["avatar_url"] = strings.TrimSpace(*input.AvatarURL)
		}
		if len(updates) > 0 {
			return tx.Model(&user).Updates(updates).Error
		}
		return nil
	})
	if err != nil {
		return LoginResult{}, err
	}
	token, err := s.Token(user.ID, "user")
	if err != nil {
		return LoginResult{}, err
	}
	return LoginResult{Token: token, User: user}, nil
}

func (s *AuthService) exchangeCode(ctx context.Context, code string) (string, error) {
	values := url.Values{"appid": {s.cfg.WechatAppID}, "secret": {s.cfg.WechatSecret}, "js_code": {code}, "grant_type": {"authorization_code"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.WechatAPIURL+"?"+values.Encode(), nil)
	if err != nil {
		return "", errors.New("wechat identity provider unavailable")
	}
	resp, err := s.client.Do(req)
	if err != nil {
		// Do not wrap url.Error: its URL contains the WeChat secret.
		return "", errors.New("wechat identity provider unavailable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", api.Unauthorized("wechat login failed")
	}
	var result wechatResponse
	decoder := json.NewDecoder(http.MaxBytesReader(nil, resp.Body, 64<<10))
	if err := decoder.Decode(&result); err != nil || result.ErrCode != 0 || result.OpenID == "" {
		return "", api.Unauthorized("wechat login failed")
	}
	return result.OpenID, nil
}

func (s *AuthService) AdminLogin(username, password string) (string, error) {
	if s.cfg.AdminUsername == "" || s.cfg.AdminPassword == "" {
		return "", api.Unauthorized("admin login is disabled")
	}
	usernameOK := subtle.ConstantTimeCompare([]byte(username), []byte(s.cfg.AdminUsername)) == 1
	passwordOK := subtle.ConstantTimeCompare([]byte(password), []byte(s.cfg.AdminPassword)) == 1
	if !usernameOK || !passwordOK {
		return "", api.Unauthorized("invalid admin credentials")
	}
	return s.Token(1, "admin")
}
