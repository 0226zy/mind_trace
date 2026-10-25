package service

import (
	"strings"
	"unicode/utf8"

	api "mind_trace/server/internal/apperr"
	"mind_trace/server/internal/models"
)

func validateText(name, value string, min, max int) error {
	length := utf8.RuneCountInString(strings.TrimSpace(value))
	if length < min || length > max {
		return api.BadRequest(name + " length is outside the allowed range")
	}
	return nil
}

func validatePage(page, pageSize int) (int, int) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	if pageSize > 100 {
		pageSize = 100
	}
	return page, pageSize
}

func validateRecordStatus(status string) error {
	switch status {
	case "registered", "evaluating", "paused", "closed":
		return nil
	default:
		return api.BadRequest("invalid record status")
	}
}

func validateThoughtStatus(status string) error {
	switch status {
	case "active", "resolved", "recurring":
		return nil
	default:
		return api.BadRequest("invalid thought status")
	}
}

func validateActions(items []models.Action) error {
	if len(items) > 100 {
		return api.BadRequest("too many controllableActions")
	}
	for _, item := range items {
		if err := validateText("action text", item.Text, 1, 500); err != nil {
			return err
		}
	}
	return nil
}

func validateUncontrollable(items []models.UncontrollableItem) error {
	if len(items) > 100 {
		return api.BadRequest("too many uncontrollableItems")
	}
	for _, item := range items {
		if err := validateText("uncontrollable item text", item.Text, 1, 500); err != nil {
			return err
		}
	}
	return nil
}

func validateClose(record models.Record) error {
	if err := validateText("ruminationType", record.RuminationType, 1, 100); err != nil {
		return err
	}
	if err := validateText("riskContent", record.RiskContent, 1, 2000); err != nil {
		return err
	}
	if record.Probability == nil || *record.Probability < 0 || *record.Probability > 100 {
		return api.BadRequest("probability is required and must be between 0 and 100")
	}
	if len(record.ControllableActions) == 0 || len(record.UncontrollableItems) == 0 {
		return api.BadRequest("controllableActions and uncontrollableItems are required")
	}
	if err := validateActions(record.ControllableActions); err != nil {
		return err
	}
	if err := validateUncontrollable(record.UncontrollableItems); err != nil {
		return err
	}
	for name, value := range map[string]string{
		"scenarioWorst": record.ScenarioWorst, "scenarioLikely": record.ScenarioLikely, "scenarioBest": record.ScenarioBest,
	} {
		if err := validateText(name, value, 1, 2000); err != nil {
			return err
		}
	}
	if len(record.CloseConfirmations) != 3 || !record.CloseConfirmations[0] || !record.CloseConfirmations[1] || !record.CloseConfirmations[2] {
		return api.BadRequest("all three close confirmations must be true")
	}
	return nil
}
