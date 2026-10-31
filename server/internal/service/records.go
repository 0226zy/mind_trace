package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"time"

	api "mind_trace/server/internal/apperr"
	"mind_trace/server/internal/models"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type RecordService struct{ db *gorm.DB }

func NewRecordService(db *gorm.DB) *RecordService { return &RecordService{db: db} }

type CreateRecordInput struct {
	ThoughtID       *uint64         `json:"thoughtId"`
	ClientRequestID *string         `json:"clientRequestId"`
	TriggerEvent    string          `json:"triggerEvent" binding:"required"`
	Emotions        models.Emotions `json:"emotions"`
	Intensity       *int            `json:"intensity"`
	LoopThought     string          `json:"loopThought" binding:"required"`
}

type RecordResult struct {
	Thought models.Thought `json:"thought"`
	Record  models.Record  `json:"record"`
}

func (s *RecordService) Create(ctx context.Context, userID uint64, input CreateRecordInput) (RecordResult, error) {
	var err error
	input.ClientRequestID, err = normalizeClientRequestID(input.ClientRequestID)
	if err != nil {
		return RecordResult{}, err
	}
	if err := validateText("triggerEvent", input.TriggerEvent, 1, 100); err != nil {
		return RecordResult{}, err
	}
	if err := validateText("loopThought", input.LoopThought, 1, 1000); err != nil {
		return RecordResult{}, err
	}
	if err := validateIntensity(input.Intensity); err != nil {
		return RecordResult{}, err
	}
	if err := validateEmotions(input.Emotions); err != nil {
		return RecordResult{}, err
	}
	if input.ThoughtID != nil && *input.ThoughtID == 0 {
		return RecordResult{}, api.BadRequest("thoughtId must be positive")
	}
	if input.Emotions == nil {
		input.Emotions = models.Emotions{}
	}
	var result RecordResult
	lookup := func() (bool, error) {
		if input.ClientRequestID == nil {
			return false, nil
		}
		existing, found, err := s.findByClientRequestID(ctx, userID, *input.ClientRequestID)
		if found {
			result = existing
		}
		return found, err
	}
	created := false
	create := func() error {
		err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var thought models.Thought
			var previous *models.Record
			if input.ThoughtID == nil {
				thought = models.Thought{UserID: userID, TriggerEvent: input.TriggerEvent, Emotions: input.Emotions, Status: "active"}
				if err := tx.Create(&thought).Error; err != nil {
					return err
				}
			} else {
				// The row lock serializes version allocation for a thought.
				if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", *input.ThoughtID, userID).First(&thought).Error; err != nil {
					if errors.Is(err, gorm.ErrRecordNotFound) {
						return api.NotFound()
					}
					return err
				}
				var last models.Record
				if err := tx.Where("thought_id = ? AND user_id = ?", thought.ID, userID).Order("version_no DESC").First(&last).Error; err != nil {
					return err
				}
				previous = &last
				thought.TriggerEvent = input.TriggerEvent
				thought.Emotions = input.Emotions
				if err := tx.Model(&models.Thought{}).Where("id = ? AND user_id = ?", thought.ID, userID).Updates(map[string]any{"trigger_event": thought.TriggerEvent, "emotions": thought.Emotions}).Error; err != nil {
					return err
				}
			}
			record := models.Record{
				ThoughtID: thought.ID, UserID: userID, ClientRequestID: input.ClientRequestID, VersionNo: 1, TriggerEvent: input.TriggerEvent,
				Emotions: input.Emotions, Intensity: input.Intensity, LoopThought: input.LoopThought,
				Status: "registered", Step: 0, ControllableActions: models.Actions{}, UncontrollableItems: models.UncontrollableItems{}, CloseConfirmations: models.Confirmations{false, false, false},
			}
			if previous != nil {
				record.VersionNo = previous.VersionNo + 1
				inheritEvaluation(&record, previous)
			}
			if err := tx.Create(&record).Error; err != nil {
				return err
			}
			status, err := recalculateThoughtStatus(tx, thought.ID, userID)
			if err != nil {
				return err
			}
			thought.Status = status
			result = RecordResult{Thought: thought, Record: record}
			return nil
		})
		created = err == nil
		return err
	}
	if err := executeIdempotent(lookup, create, isDuplicateKey); err != nil {
		return RecordResult{}, err
	}
	// Reload after commit so the first response and retries use identical
	// database-normalized timestamps and persisted values.
	if created && input.ClientRequestID != nil {
		var found bool
		result, found, err = s.findByClientRequestID(ctx, userID, *input.ClientRequestID)
		if err != nil {
			return RecordResult{}, err
		}
		if !found {
			return RecordResult{}, errors.New("committed idempotent record not found")
		}
	}
	return result, nil
}

func (s *RecordService) findByClientRequestID(ctx context.Context, userID uint64, clientRequestID string) (RecordResult, bool, error) {
	var record models.Record
	err := s.db.WithContext(ctx).Where("user_id = ? AND client_request_id = ?", userID, clientRequestID).First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return RecordResult{}, false, nil
	}
	if err != nil {
		return RecordResult{}, false, err
	}
	var thought models.Thought
	if err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", record.ThoughtID, userID).First(&thought).Error; err != nil {
		return RecordResult{}, false, err
	}
	return RecordResult{Thought: thought, Record: record}, true, nil
}

func validateIntensity(intensity *int) error {
	if intensity != nil && (*intensity < 1 || *intensity > 10) {
		return api.BadRequest("intensity must be between 1 and 10")
	}
	return nil
}

func validateEmotions(emotions models.Emotions) error {
	if len(emotions) > 20 {
		return api.BadRequest("at most 20 emotions are allowed")
	}
	for _, emotion := range emotions {
		if err := validateText("emotion", emotion, 1, 30); err != nil {
			return err
		}
	}
	return nil
}

type Page struct {
	Items    any   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"pageSize"`
}

func (s *RecordService) List(ctx context.Context, userID uint64, status string, page, pageSize int) (Page, error) {
	page, pageSize = validatePage(page, pageSize)
	if status != "" {
		if err := validateRecordStatus(status); err != nil {
			return Page{}, err
		}
	}
	query := s.db.WithContext(ctx).Model(&models.Record{}).Where("user_id = ?", userID)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return Page{}, err
	}
	items := make([]models.Record, 0)
	err := query.Order("created_at DESC, id DESC").Offset((page - 1) * pageSize).Limit(pageSize).Find(&items).Error
	return Page{Items: items, Total: total, Page: page, PageSize: pageSize}, err
}

func (s *RecordService) Get(ctx context.Context, userID, id uint64) (models.Record, error) {
	var record models.Record
	err := s.db.WithContext(ctx).Where("id = ? AND user_id = ?", id, userID).First(&record).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return record, api.NotFound()
	}
	return record, err
}

// PatchField distinguishes an omitted field from an explicit JSON null.
type PatchField[T any] struct {
	Value   T
	Present bool
	Null    bool
}

func (f *PatchField[T]) UnmarshalJSON(data []byte) error {
	f.Present = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		f.Null = true
		return nil
	}
	return json.Unmarshal(data, &f.Value)
}

type PatchRecordInput struct {
	Emotions            PatchField[models.Emotions]  `json:"emotions"`
	Intensity           PatchField[int]              `json:"intensity"`
	Step                *int                         `json:"step"`
	Status              *string                      `json:"status"`
	RuminationType      *string                      `json:"ruminationType"`
	RiskContent         *string                      `json:"riskContent"`
	Probability         *int                         `json:"probability"`
	ControllableActions *[]models.Action             `json:"controllableActions"`
	UncontrollableItems *[]models.UncontrollableItem `json:"uncontrollableItems"`
	ScenarioWorst       *string                      `json:"scenarioWorst"`
	ScenarioLikely      *string                      `json:"scenarioLikely"`
	ScenarioBest        *string                      `json:"scenarioBest"`
	CloseConfirmations  *[]bool                      `json:"closeConfirmations"`
}

func metadataPatchUpdates(input PatchRecordInput) (map[string]any, error) {
	updates := make(map[string]any)
	if input.Emotions.Present {
		if input.Emotions.Null {
			return nil, api.BadRequest("emotions must be an array")
		}
		if err := validateEmotions(input.Emotions.Value); err != nil {
			return nil, err
		}
		updates["emotions"] = input.Emotions.Value
	}
	if input.Intensity.Present {
		if input.Intensity.Null {
			updates["intensity"] = nil
		} else {
			if err := validateIntensity(&input.Intensity.Value); err != nil {
				return nil, err
			}
			updates["intensity"] = input.Intensity.Value
		}
	}
	return updates, nil
}

func (s *RecordService) Patch(ctx context.Context, userID, id uint64, input PatchRecordInput) (models.Record, error) {
	updates, err := metadataPatchUpdates(input)
	if err != nil {
		return models.Record{}, err
	}
	if input.Step != nil {
		if *input.Step < 0 || *input.Step > 7 {
			return models.Record{}, api.BadRequest("step must be between 0 and 7")
		}
		updates["step"] = *input.Step
	}
	if input.Status != nil {
		if *input.Status == "closed" {
			return models.Record{}, api.BadRequest("use the close endpoint to close a record")
		}
		if err := validateRecordStatus(*input.Status); err != nil {
			return models.Record{}, err
		}
		updates["status"] = *input.Status
	}
	textFields := []struct {
		name   string
		value  *string
		max    int
		column string
	}{
		{"ruminationType", input.RuminationType, 100, "rumination_type"},
		{"riskContent", input.RiskContent, 2000, "risk_content"},
		{"scenarioWorst", input.ScenarioWorst, 2000, "scenario_worst"},
		{"scenarioLikely", input.ScenarioLikely, 2000, "scenario_likely"},
		{"scenarioBest", input.ScenarioBest, 2000, "scenario_best"},
	}
	for _, field := range textFields {
		if field.value != nil {
			if err := validateText(field.name, *field.value, 0, field.max); err != nil {
				return models.Record{}, err
			}
			updates[field.column] = *field.value
		}
	}
	if input.Probability != nil {
		if *input.Probability < 0 || *input.Probability > 100 {
			return models.Record{}, api.BadRequest("probability must be between 0 and 100")
		}
		updates["probability"] = *input.Probability
	}
	if input.ControllableActions != nil {
		if err := validateActions(*input.ControllableActions); err != nil {
			return models.Record{}, err
		}
		updates["controllable_actions"] = models.Actions(*input.ControllableActions)
	}
	if input.UncontrollableItems != nil {
		if err := validateUncontrollable(*input.UncontrollableItems); err != nil {
			return models.Record{}, err
		}
		updates["uncontrollable_items"] = models.UncontrollableItems(*input.UncontrollableItems)
	}
	if input.CloseConfirmations != nil {
		if len(*input.CloseConfirmations) != 3 {
			return models.Record{}, api.BadRequest("closeConfirmations must contain exactly three booleans")
		}
		updates["close_confirmations"] = models.Confirmations(*input.CloseConfirmations)
	}
	if len(updates) == 0 {
		return models.Record{}, api.BadRequest("no fields to update")
	}
	syncEmotions := input.Emotions.Present
	var snapshot models.Record
	if syncEmotions {
		var err error
		snapshot, err = s.Get(ctx, userID, id)
		if err != nil {
			return models.Record{}, err
		}
	}
	var record models.Record
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var thought models.Thought
		if syncEmotions {
			// Match create/close lock order: thought before its record versions.
			if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", snapshot.ThoughtID, userID).First(&thought).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return api.NotFound()
				}
				return err
			}
		}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", id, userID).First(&record).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return api.NotFound()
			}
			return err
		}
		if syncEmotions && record.ThoughtID != thought.ID {
			return api.NotFound()
		}
		if record.Status == "closed" {
			return api.Conflict("closed records cannot be edited")
		}
		if err := tx.Model(&models.Record{}).Where("id = ? AND user_id = ?", id, userID).Updates(updates).Error; err != nil {
			return err
		}
		if syncEmotions {
			var latest models.Record
			if err := tx.Select("id").Where("thought_id = ? AND user_id = ?", record.ThoughtID, userID).Order("version_no DESC").First(&latest).Error; err != nil {
				return err
			}
			if latest.ID == id {
				return tx.Model(&models.Thought{}).Where("id = ? AND user_id = ?", thought.ID, userID).Update("emotions", input.Emotions.Value).Error
			}
		}
		return nil
	})
	if err != nil {
		return models.Record{}, err
	}
	return s.Get(ctx, userID, id)
}

func (s *RecordService) Close(ctx context.Context, userID, id uint64) (models.Record, error) {
	record, err := s.Get(ctx, userID, id)
	if err != nil {
		return models.Record{}, err
	}
	thoughtID := record.ThoughtID
	var result models.Record
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Locate the record before opening the transaction so no consistent-read
		// snapshot predates this lock. Creates and closes share this lock order.
		var thought models.Thought
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", thoughtID, userID).First(&thought).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return api.NotFound()
			}
			return err
		}
		record = models.Record{}
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND user_id = ?", id, userID).First(&record).Error; err != nil {
			return err
		}
		if record.Status == "closed" {
			return api.Conflict("record is already closed")
		}
		if err := validateClose(record); err != nil {
			return err
		}
		now := time.Now()
		if err := tx.Model(&models.Record{}).Where("id = ? AND user_id = ? AND status <> 'closed'", id, userID).Updates(map[string]any{"status": "closed", "step": 7, "closed_at": now}).Error; err != nil {
			return err
		}
		if _, err := recalculateThoughtStatus(tx, record.ThoughtID, userID); err != nil {
			return err
		}
		record.Status, record.Step, record.ClosedAt = "closed", 7, &now
		result = record
		return nil
	})
	return result, err
}

func (s *RecordService) Pause(ctx context.Context, userID, id uint64) (models.Record, error) {
	result := s.db.WithContext(ctx).Model(&models.Record{}).Where("id = ? AND user_id = ? AND status <> 'closed'", id, userID).Update("status", "paused")
	if result.Error != nil {
		return models.Record{}, result.Error
	}
	if result.RowsAffected == 0 {
		var count int64
		if err := s.db.WithContext(ctx).Model(&models.Record{}).Where("id = ? AND user_id = ?", id, userID).Count(&count).Error; err != nil {
			return models.Record{}, err
		}
		if count == 0 {
			return models.Record{}, api.NotFound()
		}
		record, err := s.Get(ctx, userID, id)
		if err != nil {
			return models.Record{}, err
		}
		if record.Status == "closed" {
			return models.Record{}, api.Conflict("closed records cannot be paused")
		}
		return record, nil
	}
	return s.Get(ctx, userID, id)
}
