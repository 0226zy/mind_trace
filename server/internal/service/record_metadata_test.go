package service

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"mind_trace/server/internal/models"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

func TestCreateRecordInputAllowsOmittedOrNullIntensity(t *testing.T) {
	for _, payload := range []string{
		`{"triggerEvent":"事","loopThought":"想"}`,
		`{"triggerEvent":"事","intensity":null,"loopThought":"想"}`,
	} {
		var input CreateRecordInput
		if err := json.Unmarshal([]byte(payload), &input); err != nil {
			t.Fatalf("decode %s: %v", payload, err)
		}
		if input.Intensity != nil {
			t.Fatalf("empty intensity became %d for %s", *input.Intensity, payload)
		}
		if err := validateIntensity(input.Intensity); err != nil {
			t.Fatalf("empty intensity rejected: %v", err)
		}
	}

	var input CreateRecordInput
	if err := json.Unmarshal([]byte(`{"intensity":1}`), &input); err != nil {
		t.Fatal(err)
	}
	if input.Intensity == nil || *input.Intensity != 1 {
		t.Fatalf("valid intensity=%v", input.Intensity)
	}
	for _, value := range []int{0, 11} {
		if err := validateIntensity(&value); err == nil {
			t.Fatalf("out-of-range intensity %d accepted", value)
		}
	}
}

func TestRecordJSONPreservesNullIntensity(t *testing.T) {
	data, err := json.Marshal(models.Record{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"intensity":null`) {
		t.Fatalf("nil intensity was not encoded as null: %s", data)
	}
	value := 7
	data, err = json.Marshal(models.Record{Intensity: &value})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"intensity":7`) {
		t.Fatalf("present intensity was not preserved: %s", data)
	}
}

func decodePatchInput(t *testing.T, payload string) PatchRecordInput {
	t.Helper()
	var input PatchRecordInput
	if err := json.Unmarshal([]byte(payload), &input); err != nil {
		t.Fatalf("decode patch: %v", err)
	}
	return input
}

func TestPatchRecordMetadataAllowsArraysAndNullIntensity(t *testing.T) {
	input := decodePatchInput(t, `{"emotions":[],"intensity":null}`)
	updates, err := metadataPatchUpdates(input)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(updates["emotions"], models.Emotions{}) {
		t.Fatalf("empty emotions=%#v", updates["emotions"])
	}
	if value, ok := updates["intensity"]; !ok || value != nil {
		t.Fatalf("explicit null intensity was not preserved: %#v", updates)
	}

	input = decodePatchInput(t, `{"emotions":["焦虑"],"intensity":10}`)
	updates, err = metadataPatchUpdates(input)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(updates["emotions"], models.Emotions{"焦虑"}) || updates["intensity"] != 10 {
		t.Fatalf("metadata updates=%#v", updates)
	}

	updates, err = metadataPatchUpdates(PatchRecordInput{})
	if err != nil || len(updates) != 0 {
		t.Fatalf("omitted metadata produced updates=%#v err=%v", updates, err)
	}
}

func TestPatchRecordMetadataRejectsInvalidValuesIncludingNullEmotions(t *testing.T) {
	for _, payload := range []string{
		`{"emotions":null}`,
		`{"emotions":null,"intensity":5}`,
		`{"emotions":[null]}`,
		`{"intensity":0}`,
		`{"intensity":11}`,
	} {
		input := decodePatchInput(t, payload)
		if _, err := metadataPatchUpdates(input); err == nil {
			t.Fatalf("invalid patch accepted: %s", payload)
		}
	}
	for _, payload := range []string{`{"emotions":"焦虑"}`, `{"intensity":1.5}`, `{"intensity":"5"}`, `{"intensity":false}`} {
		var input PatchRecordInput
		if err := json.Unmarshal([]byte(payload), &input); err == nil {
			t.Fatalf("non-integer intensity decoded: %s", payload)
		}
	}
}

func TestIntensityTrendQueryExcludesNullWithoutCoercingToZero(t *testing.T) {
	db, err := gorm.Open(mysql.New(mysql.Config{
		DSN:                       "gorm:gorm@tcp(127.0.0.1:1)/gorm?charset=utf8mb4&parseTime=True&loc=Local",
		SkipInitializeWithVersion: true,
	}), &gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatalf("open dry-run MySQL: %v", err)
	}
	service := NewThoughtService(db)
	var trend []IntensityPoint
	query := service.intensityTrendQuery(context.Background(), 1, time.Now()).Find(&trend)
	if query.Error != nil {
		t.Fatal(query.Error)
	}
	sql := query.Statement.SQL.String()
	for _, fragment := range []string{"AVG(intensity)", "intensity IS NOT NULL"} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("trend SQL does not contain %q: %s", fragment, sql)
		}
	}
	if strings.Contains(strings.ToUpper(sql), "COALESCE") || strings.Contains(strings.ToUpper(sql), "IFNULL") {
		t.Fatalf("trend SQL coerces null intensity: %s", sql)
	}
}
