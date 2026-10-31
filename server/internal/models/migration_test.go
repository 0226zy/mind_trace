package models

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"gorm.io/gorm/schema"
)

func parseSchema(t *testing.T, value any) *schema.Schema {
	t.Helper()
	parsed, err := schema.Parse(value, &sync.Map{}, schema.NamingStrategy{})
	if err != nil {
		t.Fatalf("parse GORM schema: %v", err)
	}
	return parsed
}

func TestCascadeForeignKeysMatchProductionMigration(t *testing.T) {
	user := parseSchema(t, &User{})
	thought := parseSchema(t, &Thought{})
	tests := []struct {
		name, relation, constraint, owner, referenced string
		schema                                        *schema.Schema
	}{
		{name: "user to thoughts", schema: user, relation: "Thoughts", constraint: "fk_thoughts_user", owner: "thoughts", referenced: "users"},
		{name: "user to records", schema: user, relation: "Records", constraint: "fk_records_user", owner: "records", referenced: "users"},
		{name: "thought to records", schema: thought, relation: "Records", constraint: "fk_records_thought", owner: "records", referenced: "thoughts"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			relation := test.schema.Relationships.Relations[test.relation]
			if relation == nil {
				t.Fatalf("relationship %s is missing", test.relation)
			}
			constraint := relation.ParseConstraint()
			if constraint == nil {
				t.Fatal("foreign-key constraint was not generated")
			}
			if constraint.Name != test.constraint || constraint.OnDelete != "CASCADE" {
				t.Fatalf("constraint=%q onDelete=%q", constraint.Name, constraint.OnDelete)
			}
			if constraint.Schema == nil || constraint.Schema.Table != test.owner || constraint.ReferenceSchema == nil || constraint.ReferenceSchema.Table != test.referenced {
				t.Fatalf("unexpected constraint direction: %+v", constraint)
			}
			if len(constraint.ForeignKeys) != 1 || len(constraint.References) != 1 || constraint.References[0].DBName != "id" {
				t.Fatalf("unexpected foreign-key columns: %+v", constraint)
			}
		})
	}
}

func TestCheckConstraintsMatchProductionMigration(t *testing.T) {
	thoughtChecks := parseSchema(t, &Thought{}).ParseCheckConstraints()
	if got := thoughtChecks["chk_thoughts_status"].Constraint; got != "status IN ('active','resolved','recurring')" {
		t.Fatalf("thought status CHECK=%q", got)
	}
	recordChecks := parseSchema(t, &Record{}).ParseCheckConstraints()
	expected := map[string]string{
		"chk_records_intensity":   "intensity IS NULL OR intensity BETWEEN 1 AND 10",
		"chk_records_probability": "probability IS NULL OR probability BETWEEN 0 AND 100",
		"chk_records_step":        "step BETWEEN 0 AND 7",
		"chk_records_status":      "status IN ('registered','evaluating','paused','closed')",
	}
	if len(recordChecks) != len(expected) {
		t.Fatalf("generated %d record CHECKs, want %d: %+v", len(recordChecks), len(expected), recordChecks)
	}
	for name, expression := range expected {
		check, ok := recordChecks[name]
		if !ok || check.Constraint != expression {
			t.Errorf("%s=%q, %v; want %q", name, check.Constraint, ok, expression)
		}
		sql, _ := check.Build()
		if sql != "CONSTRAINT ? CHECK (?)" {
			t.Fatalf("unexpected CHECK builder SQL %q", sql)
		}
	}

	migration, err := os.ReadFile(filepath.Join("..", "..", "migrations", "001_init.sql"))
	if err != nil {
		t.Fatalf("read production migration: %v", err)
	}
	sql := string(migration)
	for _, name := range []string{"fk_thoughts_user", "fk_records_user", "fk_records_thought", "chk_thoughts_status", "chk_records_intensity", "chk_records_probability", "chk_records_step", "chk_records_status"} {
		if !strings.Contains(sql, "CONSTRAINT "+name+" ") {
			t.Errorf("production migration does not contain constraint %s", name)
		}
	}
}

func TestIntensityIsNullableInModelAndMigrations(t *testing.T) {
	field := parseSchema(t, &Record{}).FieldsByName["Intensity"]
	if field == nil || field.NotNull {
		t.Fatalf("GORM intensity field is not nullable: %+v", field)
	}
	initial, err := os.ReadFile(filepath.Join("..", "..", "migrations", "001_init.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(initial), "intensity INT NULL") {
		t.Fatal("fresh-install migration does not allow null intensity")
	}
	upgrade, err := os.ReadFile(filepath.Join("..", "..", "migrations", "002_allow_null_intensity.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(upgrade), "ALTER TABLE records MODIFY COLUMN intensity INT NULL") {
		t.Fatal("forward migration does not make intensity nullable")
	}
}
