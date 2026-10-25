package service

import (
	"mind_trace/server/internal/models"

	"gorm.io/gorm"
)

const recurringVersionThreshold = 3

func calculateThoughtStatus(versionCount, unfinishedCount int64) string {
	if versionCount >= recurringVersionThreshold {
		return "recurring"
	}
	if versionCount > 0 && unfinishedCount == 0 {
		return "resolved"
	}
	return "active"
}

// recalculateThoughtStatus runs inside the caller's transaction. The caller
// must hold the thought row lock so creates and closes for one thought are
// serialized and both counts describe the same version history.
func recalculateThoughtStatus(tx *gorm.DB, thoughtID, userID uint64) (string, error) {
	var versionCount int64
	if err := tx.Model(&models.Record{}).Where("thought_id = ? AND user_id = ?", thoughtID, userID).Count(&versionCount).Error; err != nil {
		return "", err
	}
	var unfinishedCount int64
	if err := tx.Model(&models.Record{}).Where("thought_id = ? AND user_id = ? AND status <> 'closed'", thoughtID, userID).Count(&unfinishedCount).Error; err != nil {
		return "", err
	}
	status := calculateThoughtStatus(versionCount, unfinishedCount)
	if err := tx.Model(&models.Thought{}).Where("id = ? AND user_id = ?", thoughtID, userID).Update("status", status).Error; err != nil {
		return "", err
	}
	return status, nil
}

func inheritEvaluation(record *models.Record, previous *models.Record) {
	record.RuminationType = previous.RuminationType
	record.RiskContent = previous.RiskContent
	record.Probability = previous.Probability
	record.ControllableActions = previous.ControllableActions
	record.UncontrollableItems = previous.UncontrollableItems
	record.ScenarioWorst = previous.ScenarioWorst
	record.ScenarioLikely = previous.ScenarioLikely
	record.ScenarioBest = previous.ScenarioBest
	// Confirmation is version-local and must never be inherited.
	record.CloseConfirmations = models.Confirmations{false, false, false}
}
