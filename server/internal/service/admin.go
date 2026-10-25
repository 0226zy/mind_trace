package service

import (
	"context"
	"time"

	"mind_trace/server/internal/models"

	"gorm.io/gorm"
)

type AdminService struct{ db *gorm.DB }

func NewAdminService(db *gorm.DB) *AdminService { return &AdminService{db: db} }

func (s *AdminService) Overview(ctx context.Context) (map[string]any, error) {
	var totalUsers, totalThoughts, totalRecords, closedRecords, activeUsers int64
	queries := []struct {
		query  *gorm.DB
		target *int64
	}{
		{s.db.WithContext(ctx).Model(&models.User{}), &totalUsers},
		{s.db.WithContext(ctx).Model(&models.Thought{}), &totalThoughts},
		{s.db.WithContext(ctx).Model(&models.Record{}), &totalRecords},
		{s.db.WithContext(ctx).Model(&models.Record{}).Where("status = 'closed'"), &closedRecords},
		{s.db.WithContext(ctx).Model(&models.User{}).Where("id IN (?)", s.db.Model(&models.Record{}).Select("user_id").Where("created_at >= ?", time.Now().AddDate(0, 0, -30)).Group("user_id")), &activeUsers},
	}
	for _, item := range queries {
		if err := item.query.Count(item.target).Error; err != nil {
			return nil, err
		}
	}
	return map[string]any{"totalUsers": totalUsers, "activeUsers30d": activeUsers, "totalThoughts": totalThoughts, "totalRecords": totalRecords, "closedRecords": closedRecords}, nil
}

type AdminUser struct {
	ID           uint64    `json:"id"`
	Nickname     string    `json:"nickname"`
	CreatedAt    time.Time `json:"createdAt"`
	ThoughtCount int64     `json:"thoughtCount"`
	RecordCount  int64     `json:"recordCount"`
}

func (s *AdminService) Users(ctx context.Context, page, pageSize int) (Page, error) {
	page, pageSize = validatePage(page, pageSize)
	var total int64
	if err := s.db.WithContext(ctx).Model(&models.User{}).Count(&total).Error; err != nil {
		return Page{}, err
	}
	thoughtCounts := s.db.Model(&models.Thought{}).Select("user_id, COUNT(*) AS count").Group("user_id")
	recordCounts := s.db.Model(&models.Record{}).Select("user_id, COUNT(*) AS count").Group("user_id")
	items := make([]AdminUser, 0)
	err := s.db.WithContext(ctx).Table("users AS u").
		Select("u.id, u.nickname, u.created_at, COALESCE(tc.count, 0) AS thought_count, COALESCE(rc.count, 0) AS record_count").
		Joins("LEFT JOIN (?) AS tc ON tc.user_id = u.id", thoughtCounts).
		Joins("LEFT JOIN (?) AS rc ON rc.user_id = u.id", recordCounts).
		Order("u.created_at DESC, u.id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Scan(&items).Error
	return Page{Items: items, Total: total, Page: page, PageSize: pageSize}, err
}
