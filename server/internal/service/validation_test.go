package service

import (
	"strings"
	"testing"

	"mind_trace/server/internal/models"
)

func completeRecord() models.Record {
	probability := 40
	return models.Record{
		RuminationType: "灾难化", RiskContent: "担心被辞退", Probability: &probability,
		ControllableActions: []models.Action{{Text: "核对事实", Done: true}},
		UncontrollableItems: []models.UncontrollableItem{{Text: "他人的想法", CrossedOut: true}},
		ScenarioWorst:       "失去工作", ScenarioLikely: "修正错误", ScenarioBest: "顺利完成",
		CloseConfirmations: models.Confirmations{true, true, true},
	}
}

func TestCloseValidationAcceptsCompleteRecord(t *testing.T) {
	if err := validateClose(completeRecord()); err != nil {
		t.Fatalf("complete record rejected: %v", err)
	}
}

func TestCloseValidationRequiredFields(t *testing.T) {
	tests := []struct {
		name   string
		change func(*models.Record)
	}{
		{name: "rumination type", change: func(r *models.Record) { r.RuminationType = "" }},
		{name: "risk", change: func(r *models.Record) { r.RiskContent = " " }},
		{name: "probability missing", change: func(r *models.Record) { r.Probability = nil }},
		{name: "probability above range", change: func(r *models.Record) { value := 101; r.Probability = &value }},
		{name: "actions", change: func(r *models.Record) { r.ControllableActions = nil }},
		{name: "uncontrollable items", change: func(r *models.Record) { r.UncontrollableItems = nil }},
		{name: "worst scenario", change: func(r *models.Record) { r.ScenarioWorst = "" }},
		{name: "likely scenario", change: func(r *models.Record) { r.ScenarioLikely = "" }},
		{name: "best scenario", change: func(r *models.Record) { r.ScenarioBest = "" }},
		{name: "confirmation count", change: func(r *models.Record) { r.CloseConfirmations = models.Confirmations{true, true} }},
		{name: "unconfirmed", change: func(r *models.Record) { r.CloseConfirmations = models.Confirmations{true, false, true} }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			record := completeRecord()
			test.change(&record)
			if err := validateClose(record); err == nil {
				t.Fatal("incomplete record passed close validation")
			}
		})
	}
}

func TestCloseValidationAllowsProbabilityZero(t *testing.T) {
	record := completeRecord()
	zero := 0
	record.Probability = &zero
	if err := validateClose(record); err != nil {
		t.Fatalf("zero probability should be valid: %v", err)
	}
}

func TestTextValidationCountsRunes(t *testing.T) {
	if err := validateText("triggerEvent", strings.Repeat("事", 100), 1, 100); err != nil {
		t.Fatalf("100 Chinese characters rejected: %v", err)
	}
	if err := validateText("triggerEvent", strings.Repeat("事", 101), 1, 100); err == nil {
		t.Fatal("101 Chinese characters accepted")
	}
}
