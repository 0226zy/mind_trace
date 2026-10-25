package service

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	api "mind_trace/server/internal/apperr"
	"mind_trace/server/internal/models"

	"gorm.io/gorm"
)

type ThoughtService struct{ db *gorm.DB }

func NewThoughtService(db *gorm.DB) *ThoughtService { return &ThoughtService{db: db} }

type ThoughtListItem struct {
	Thought       models.Thought `json:"thought"`
	VersionCount  int64          `json:"versionCount"`
	LatestRecord  *models.Record `json:"latestRecord"`
	CurrentStep   int            `json:"currentStep"`
	CurrentStatus string         `json:"currentStatus"`
}

func (s *ThoughtService) List(ctx context.Context, userID uint64, text, status, emotion string, page, pageSize int) (Page, error) {
	page, pageSize = validatePage(page, pageSize)
	if len(text) > 200 || len(emotion) > 30 {
		return Page{}, api.BadRequest("query or emotion is too long")
	}
	if status != "" {
		if err := validateThoughtStatus(status); err != nil {
			return Page{}, err
		}
	}
	query := s.db.WithContext(ctx).Model(&models.Thought{}).Where("user_id = ?", userID)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	if text = strings.TrimSpace(text); text != "" {
		like := "%" + escapeLike(text) + "%"
		versionSearch := s.db.Model(&models.Record{}).Select("1").
			Where("records.thought_id = thoughts.id AND records.user_id = ?", userID).
			Where("(trigger_event LIKE ? ESCAPE '\\\\' OR loop_thought LIKE ? ESCAPE '\\\\' OR risk_content LIKE ? ESCAPE '\\\\')", like, like, like)
		query = query.Where("(trigger_event LIKE ? ESCAPE '\\\\' OR EXISTS (?))", like, versionSearch)
	}
	if emotion = strings.TrimSpace(emotion); emotion != "" {
		encoded, _ := json.Marshal(emotion)
		query = query.Where("JSON_CONTAINS(emotions, ?, '$')", string(encoded))
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return Page{}, err
	}
	thoughts := make([]models.Thought, 0)
	if err := query.Preload("Records", func(db *gorm.DB) *gorm.DB {
		return db.Where("user_id = ?", userID).Order("version_no DESC")
	}).Order("updated_at DESC, id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&thoughts).Error; err != nil {
		return Page{}, err
	}
	items := make([]ThoughtListItem, 0, len(thoughts))
	for _, thought := range thoughts {
		item := ThoughtListItem{Thought: thought, VersionCount: int64(len(thought.Records)), CurrentStatus: "registered"}
		if len(thought.Records) > 0 {
			latest := thought.Records[0]
			item.LatestRecord = &latest
			item.CurrentStep = latest.Step
			item.CurrentStatus = latest.Status
		}
		item.Thought.Records = nil
		items = append(items, item)
	}
	return Page{Items: items, Total: total, Page: page, PageSize: pageSize}, nil
}

func escapeLike(value string) string {
	value = strings.ReplaceAll(value, "\\", "\\\\")
	value = strings.ReplaceAll(value, "%", "\\%")
	return strings.ReplaceAll(value, "_", "\\_")
}

type ThoughtDetail struct {
	Thought models.Thought  `json:"thought"`
	Records []models.Record `json:"records"`
}

func (s *ThoughtService) Get(ctx context.Context, userID, id uint64) (ThoughtDetail, error) {
	var thought models.Thought
	if err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, userID).First(&thought).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ThoughtDetail{}, api.NotFound()
		}
		return ThoughtDetail{}, err
	}
	records := make([]models.Record, 0)
	if err := s.db.WithContext(ctx).Where("thought_id = ? AND user_id = ?", id, userID).Order("version_no DESC").Find(&records).Error; err != nil {
		return ThoughtDetail{}, err
	}
	return ThoughtDetail{Thought: thought, Records: records}, nil
}

type MatchItem struct {
	Thought models.Thought `json:"thought"`
	Score   float64        `json:"score"`
}

func (s *ThoughtService) Match(ctx context.Context, userID uint64, text string) ([]MatchItem, error) {
	if err := validateText("text", text, 1, 1000); err != nil {
		return nil, err
	}
	thoughts := make([]models.Thought, 0)
	if err := s.db.WithContext(ctx).Where("user_id = ?", userID).Preload("Records", func(db *gorm.DB) *gorm.DB {
		return db.Where("user_id = ?", userID).Order("version_no DESC")
	}).Find(&thoughts).Error; err != nil {
		return nil, err
	}
	items := make([]MatchItem, 0)
	for _, thought := range thoughts {
		score := Similarity(text, thought.TriggerEvent)
		for _, record := range thought.Records {
			candidate := Similarity(text, record.TriggerEvent+" "+record.LoopThought)
			if candidate > score {
				score = candidate
			}
		}
		if score >= 0.15 {
			thought.Records = nil
			items = append(items, MatchItem{Thought: thought, Score: float64(int(score*10000+0.5)) / 10000})
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Score == items[j].Score {
			return items[i].Thought.ID < items[j].Thought.ID
		}
		return items[i].Score > items[j].Score
	})
	if len(items) > 20 {
		items = items[:20]
	}
	return items, nil
}

func (s *ThoughtService) Dashboard(ctx context.Context, userID uint64) (map[string]any, error) {
	var todayCount, pendingCount, closedCount, thoughtCount int64
	now := time.Now()
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	queries := []struct {
		query  *gorm.DB
		target *int64
	}{
		{s.db.WithContext(ctx).Model(&models.Record{}).Where("user_id = ? AND created_at >= ?", userID, start), &todayCount},
		{s.db.WithContext(ctx).Model(&models.Record{}).Where("user_id = ? AND status <> 'closed'", userID), &pendingCount},
		{s.db.WithContext(ctx).Model(&models.Record{}).Where("user_id = ? AND status = 'closed'", userID), &closedCount},
		{s.db.WithContext(ctx).Model(&models.Thought{}).Where("user_id = ?", userID), &thoughtCount},
	}
	for _, item := range queries {
		if err := item.query.Count(item.target).Error; err != nil {
			return nil, err
		}
	}
	return map[string]any{"todayCount": todayCount, "pendingCount": pendingCount, "closedCount": closedCount, "thoughtCount": thoughtCount}, nil
}

type IntensityPoint struct {
	Date         string  `json:"date"`
	AvgIntensity float64 `json:"avgIntensity"`
}

func (s *ThoughtService) Stats(ctx context.Context, userID uint64) (map[string]any, error) {
	var totalThoughts, totalRecords, closedRecords, recurringThoughts int64
	counts := []struct {
		query  *gorm.DB
		target *int64
	}{
		{s.db.WithContext(ctx).Model(&models.Thought{}).Where("user_id = ?", userID), &totalThoughts},
		{s.db.WithContext(ctx).Model(&models.Record{}).Where("user_id = ?", userID), &totalRecords},
		{s.db.WithContext(ctx).Model(&models.Record{}).Where("user_id = ? AND status = 'closed'", userID), &closedRecords},
		{s.db.WithContext(ctx).Model(&models.Thought{}).Where("user_id = ?", userID).Where("id IN (?)", s.db.Model(&models.Record{}).Select("thought_id").Where("user_id = ?", userID).Group("thought_id").Having("COUNT(*) >= ?", recurringVersionThreshold)), &recurringThoughts},
	}
	for _, item := range counts {
		if err := item.query.Count(item.target).Error; err != nil {
			return nil, err
		}
	}
	completionRate := 0.0
	if totalRecords > 0 {
		completionRate = float64(closedRecords) / float64(totalRecords)
	}
	emotionCounts := map[string]int64{}
	rows, err := s.db.WithContext(ctx).Raw("SELECT emotion, COUNT(*) AS count FROM thoughts JOIN JSON_TABLE(thoughts.emotions, '$[*]' COLUMNS (emotion VARCHAR(30) PATH '$')) AS emotion_values WHERE thoughts.user_id = ? GROUP BY emotion", userID).Rows()
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var emotion string
		var count int64
		if err := rows.Scan(&emotion, &count); err != nil {
			return nil, err
		}
		emotionCounts[emotion] = count
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	trend := make([]IntensityPoint, 0)
	now := time.Now()
	since := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -29)
	if err := s.db.WithContext(ctx).Model(&models.Record{}).Select("DATE(created_at) AS date, AVG(intensity) AS avg_intensity").Where("user_id = ? AND created_at >= ?", userID, since).Group("DATE(created_at)").Order("date ASC").Scan(&trend).Error; err != nil {
		return nil, err
	}
	return map[string]any{"totalThoughts": totalThoughts, "totalRecords": totalRecords, "closedRecords": closedRecords, "completionRate": completionRate, "recurringThoughts": recurringThoughts, "emotionCounts": emotionCounts, "intensityTrend": trend}, nil
}

func (s *ThoughtService) DeleteUserData(ctx context.Context, userID uint64) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ?", userID).Delete(&models.Record{}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ?", userID).Delete(&models.Thought{}).Error; err != nil {
			return err
		}
		result := tx.Where("id = ?", userID).Delete(&models.User{})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return api.NotFound()
		}
		return nil
	})
}
