package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWechatCodeExchange(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		if query.Get("appid") != "test-app" || query.Get("secret") != "test-secret" || query.Get("js_code") != "real-code" || query.Get("grant_type") != "authorization_code" {
			t.Errorf("unexpected WeChat query: %v", query)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"openid":"wechat-open-id","session_key":"must-not-leave-this-function"}`))
	}))
	defer server.Close()
	svc := NewAuthService(nil, authConfig())
	svc.cfg.WechatAppID, svc.cfg.WechatSecret, svc.cfg.WechatAPIURL = "test-app", "test-secret", server.URL
	openID, err := svc.exchangeCode(context.Background(), "real-code")
	if err != nil || openID != "wechat-open-id" {
		t.Fatalf("exchange failed: openID=%q err=%v", openID, err)
	}
}

func TestWechatErrorsDoNotExposeSecret(t *testing.T) {
	svc := NewAuthService(nil, authConfig())
	svc.cfg.WechatAppID, svc.cfg.WechatSecret, svc.cfg.WechatAPIURL = "test-app", "highly-sensitive-secret", "http://127.0.0.1:1"
	_, err := svc.exchangeCode(context.Background(), "real-code")
	if err == nil {
		t.Fatal("unreachable identity provider unexpectedly succeeded")
	}
	if strings.Contains(err.Error(), svc.cfg.WechatSecret) {
		t.Fatalf("error leaked WeChat secret: %v", err)
	}
}
