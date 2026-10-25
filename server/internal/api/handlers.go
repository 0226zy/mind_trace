package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"mind_trace/server/internal/models"
	"mind_trace/server/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type Handler struct {
	db       *gorm.DB
	auth     *service.AuthService
	records  *service.RecordService
	thoughts *service.ThoughtService
	admin    *service.AdminService
}

func NewHandler(db *gorm.DB, auth *service.AuthService, records *service.RecordService, thoughts *service.ThoughtService, admin *service.AdminService) *Handler {
	return &Handler{db: db, auth: auth, records: records, thoughts: thoughts, admin: admin}
}

func decodeJSON(c *gin.Context, target any) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return BadRequest("invalid JSON request: " + err.Error())
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return BadRequest("request must contain one JSON object")
	}
	return nil
}

func pathID(c *gin.Context) (uint64, error) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		return 0, BadRequest("id must be a positive integer")
	}
	return id, nil
}

func pagination(c *gin.Context) (int, int, error) {
	page, pageSize := 1, 20
	var err error
	if raw := c.Query("page"); raw != "" {
		page, err = strconv.Atoi(raw)
		if err != nil || page < 1 {
			return 0, 0, BadRequest("page must be a positive integer")
		}
	}
	if raw := c.Query("pageSize"); raw != "" {
		pageSize, err = strconv.Atoi(raw)
		if err != nil || pageSize < 1 {
			return 0, 0, BadRequest("pageSize must be a positive integer")
		}
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize, nil
}

func (h *Handler) WechatLogin(c *gin.Context) {
	var input service.LoginInput
	if err := decodeJSON(c, &input); err != nil {
		Error(c, err)
		return
	}
	result, err := h.auth.WechatLogin(c.Request.Context(), input)
	if err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, result)
}

func (h *Handler) Me(c *gin.Context) {
	var user models.User
	if err := h.db.WithContext(c.Request.Context()).Where("id = ?", UserID(c)).First(&user).Error; err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, user)
}

func (h *Handler) DeleteMe(c *gin.Context) {
	if err := h.thoughts.DeleteUserData(c.Request.Context(), UserID(c)); err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, gin.H{"deleted": true})
}

func (h *Handler) Dashboard(c *gin.Context) {
	result, err := h.thoughts.Dashboard(c.Request.Context(), UserID(c))
	if err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, result)
}

func (h *Handler) Match(c *gin.Context) {
	var input struct {
		Text string `json:"text"`
	}
	if err := decodeJSON(c, &input); err != nil {
		Error(c, err)
		return
	}
	items, err := h.thoughts.Match(c.Request.Context(), UserID(c), input.Text)
	if err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, gin.H{"items": items})
}

func (h *Handler) CreateRecord(c *gin.Context) {
	var input service.CreateRecordInput
	if err := decodeJSON(c, &input); err != nil {
		Error(c, err)
		return
	}
	result, err := h.records.Create(c.Request.Context(), UserID(c), input)
	if err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusCreated, result)
}

func (h *Handler) ListRecords(c *gin.Context) {
	page, pageSize, err := pagination(c)
	if err != nil {
		Error(c, err)
		return
	}
	result, err := h.records.List(c.Request.Context(), UserID(c), c.Query("status"), page, pageSize)
	if err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, result)
}

func (h *Handler) GetRecord(c *gin.Context) {
	id, err := pathID(c)
	if err != nil {
		Error(c, err)
		return
	}
	result, err := h.records.Get(c.Request.Context(), UserID(c), id)
	if err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, result)
}

func (h *Handler) PatchRecord(c *gin.Context) {
	id, err := pathID(c)
	if err != nil {
		Error(c, err)
		return
	}
	var input service.PatchRecordInput
	if err := decodeJSON(c, &input); err != nil {
		Error(c, err)
		return
	}
	result, err := h.records.Patch(c.Request.Context(), UserID(c), id, input)
	if err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, result)
}

func (h *Handler) CloseRecord(c *gin.Context) {
	id, err := pathID(c)
	if err != nil {
		Error(c, err)
		return
	}
	result, err := h.records.Close(c.Request.Context(), UserID(c), id)
	if err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, result)
}

func (h *Handler) PauseRecord(c *gin.Context) {
	id, err := pathID(c)
	if err != nil {
		Error(c, err)
		return
	}
	result, err := h.records.Pause(c.Request.Context(), UserID(c), id)
	if err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, result)
}

func (h *Handler) ListThoughts(c *gin.Context) {
	page, pageSize, err := pagination(c)
	if err != nil {
		Error(c, err)
		return
	}
	result, err := h.thoughts.List(c.Request.Context(), UserID(c), c.Query("query"), c.Query("status"), c.Query("emotion"), page, pageSize)
	if err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, result)
}

func (h *Handler) GetThought(c *gin.Context) {
	id, err := pathID(c)
	if err != nil {
		Error(c, err)
		return
	}
	result, err := h.thoughts.Get(c.Request.Context(), UserID(c), id)
	if err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, result)
}

func (h *Handler) Stats(c *gin.Context) {
	result, err := h.thoughts.Stats(c.Request.Context(), UserID(c))
	if err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, result)
}

func (h *Handler) AdminLogin(c *gin.Context) {
	var input struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decodeJSON(c, &input); err != nil {
		Error(c, err)
		return
	}
	if strings.TrimSpace(input.Username) == "" || input.Password == "" || len(input.Username) > 200 || len(input.Password) > 500 {
		Error(c, BadRequest("username and password are required"))
		return
	}
	token, err := h.auth.AdminLogin(input.Username, input.Password)
	if err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, gin.H{"token": token})
}

func (h *Handler) AdminOverview(c *gin.Context) {
	result, err := h.admin.Overview(c.Request.Context())
	if err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, result)
}

func (h *Handler) AdminUsers(c *gin.Context) {
	page, pageSize, err := pagination(c)
	if err != nil {
		Error(c, err)
		return
	}
	result, err := h.admin.Users(c.Request.Context(), page, pageSize)
	if err != nil {
		Error(c, err)
		return
	}
	Data(c, http.StatusOK, result)
}
