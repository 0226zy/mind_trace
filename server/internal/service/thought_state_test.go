package service

import (
	"reflect"
	"testing"

	"mind_trace/server/internal/models"
)

func TestCalculateThoughtStatus(t *testing.T) {
	tests := []struct {
		name                 string
		versions, unfinished int64
		want                 string
	}{
		{name: "no versions is defensive active", versions: 0, unfinished: 0, want: "active"},
		{name: "first open version", versions: 1, unfinished: 1, want: "active"},
		{name: "two versions with one unfinished", versions: 2, unfinished: 1, want: "active"},
		{name: "one closed version", versions: 1, unfinished: 0, want: "resolved"},
		{name: "two closed versions", versions: 2, unfinished: 0, want: "resolved"},
		{name: "three open versions", versions: 3, unfinished: 3, want: "recurring"},
		{name: "three versions all closed remains recurring", versions: 3, unfinished: 0, want: "recurring"},
		{name: "more than three versions", versions: 4, unfinished: 1, want: "recurring"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := calculateThoughtStatus(test.versions, test.unfinished); got != test.want {
				t.Fatalf("calculateThoughtStatus(%d, %d)=%q, want %q", test.versions, test.unfinished, got, test.want)
			}
		})
	}
}

func TestRecurringThresholdIsThreeVersions(t *testing.T) {
	if recurringVersionThreshold != 3 {
		t.Fatalf("recurringVersionThreshold=%d, want 3", recurringVersionThreshold)
	}
	if calculateThoughtStatus(recurringVersionThreshold-1, 1) == "recurring" {
		t.Fatal("fewer than three versions must not be recurring")
	}
	if calculateThoughtStatus(recurringVersionThreshold, 1) != "recurring" {
		t.Fatal("three versions must be recurring")
	}
}

func TestInheritEvaluationResetsCloseConfirmations(t *testing.T) {
	previous := completeRecord()
	next := models.Record{Status: "registered", Step: 0}
	inheritEvaluation(&next, &previous)
	if next.RuminationType != previous.RuminationType || next.RiskContent != previous.RiskContent || next.Probability != previous.Probability {
		t.Fatal("evaluation text or probability was not inherited")
	}
	if !reflect.DeepEqual(next.ControllableActions, previous.ControllableActions) {
		t.Fatal("controllable actions were not inherited")
	}
	if !reflect.DeepEqual(next.UncontrollableItems, previous.UncontrollableItems) {
		t.Fatal("uncontrollable items were not inherited")
	}
	if next.ScenarioWorst != previous.ScenarioWorst || next.ScenarioLikely != previous.ScenarioLikely || next.ScenarioBest != previous.ScenarioBest {
		t.Fatal("scenario evaluation was not inherited")
	}
	wantConfirmations := models.Confirmations{false, false, false}
	if !reflect.DeepEqual(next.CloseConfirmations, wantConfirmations) {
		t.Fatalf("confirmations=%v, want %v", next.CloseConfirmations, wantConfirmations)
	}
	if !reflect.DeepEqual(previous.CloseConfirmations, models.Confirmations{true, true, true}) {
		t.Fatal("inheritance mutated the previous version")
	}
	if next.Status != "registered" || next.Step != 0 {
		t.Fatal("inheritance changed version-local status or step")
	}
}
