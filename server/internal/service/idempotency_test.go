package service

import (
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"mind_trace/server/internal/models"

	mysqlDriver "github.com/go-sql-driver/mysql"
)

func TestNormalizeClientRequestID(t *testing.T) {
	if got, err := normalizeClientRequestID(nil); err != nil || got != nil {
		t.Fatalf("omitted ID must remain SQL NULL: got=%v err=%v", got, err)
	}
	raw := "  mini-program-request-123  "
	got, err := normalizeClientRequestID(&raw)
	if err != nil || got == nil || *got != "mini-program-request-123" {
		t.Fatalf("valid ID rejected: got=%v err=%v", got, err)
	}
	for _, invalid := range []string{"", "   ", strings.Repeat("x", 65)} {
		if _, err := normalizeClientRequestID(&invalid); err == nil {
			t.Fatalf("invalid clientRequestId %q accepted", invalid)
		}
	}
	chinese := strings.Repeat("请", 64)
	if _, err := normalizeClientRequestID(&chinese); err != nil {
		t.Fatalf("64 Unicode characters rejected: %v", err)
	}
}

func TestExecuteIdempotentReturnsOriginalAfterCommittedRetry(t *testing.T) {
	original := RecordResult{Thought: models.Thought{ID: 11}, Record: models.Record{ID: 22, ThoughtID: 11, VersionNo: 1}}
	stored := false
	createCalls := 0
	lookup := func() (bool, error) { return stored, nil }
	create := func() error {
		createCalls++
		if stored {
			return &mysqlDriver.MySQLError{Number: 1062}
		}
		stored = true
		return nil
	}
	if err := executeIdempotent(lookup, create, isDuplicateKey); err != nil {
		t.Fatalf("first create failed: %v", err)
	}
	result := original
	if err := executeIdempotent(lookup, create, isDuplicateKey); err != nil {
		t.Fatalf("committed retry failed: %v", err)
	}
	if result.Record.ID != original.Record.ID || result.Thought.ID != original.Thought.ID || createCalls != 1 || !stored {
		t.Fatalf("retry changed original result: result=%+v createCalls=%d stored=%v", result, createCalls, stored)
	}
}

func TestExecuteIdempotentRecoversFromUniqueKeyRace(t *testing.T) {
	// Both callers finish their initial lookup before either can create,
	// reproducing the committed-winner/unique-key-loser interleaving.
	const callers = 2
	var barrier sync.WaitGroup
	barrier.Add(callers)
	release := make(chan struct{})
	go func() {
		barrier.Wait()
		close(release)
	}()
	var mu sync.Mutex
	stored := false
	createCalls := 0
	results := make([]RecordResult, callers)
	errs := make([]error, callers)
	var callersDone sync.WaitGroup
	callersDone.Add(callers)
	for i := 0; i < callers; i++ {
		go func(index int) {
			defer callersDone.Done()
			firstLookup := true
			lookup := func() (bool, error) {
				mu.Lock()
				found := stored
				mu.Unlock()
				if firstLookup {
					firstLookup = false
					barrier.Done()
					<-release
				}
				return found, nil
			}
			create := func() error {
				mu.Lock()
				defer mu.Unlock()
				createCalls++
				if stored {
					return &mysqlDriver.MySQLError{Number: 1062, Message: "duplicate entry"}
				}
				stored = true
				return nil
			}
			errs[index] = executeIdempotent(lookup, create, isDuplicateKey)
			if errs[index] == nil {
				results[index] = RecordResult{Thought: models.Thought{ID: 1}, Record: models.Record{ID: 1, VersionNo: 1}}
			}
		}(i)
	}
	callersDone.Wait()
	for i := range errs {
		if errs[i] != nil {
			t.Fatalf("caller %d got conflict instead of winner result: %v", i, errs[i])
		}
		if results[i].Record.ID != results[0].Record.ID || results[i].Thought.ID != results[0].Thought.ID || results[i].Record.VersionNo != results[0].Record.VersionNo {
			t.Fatalf("caller %d got different result: %+v vs %+v", i, results[i], results[0])
		}
	}
	if createCalls != 2 || !stored {
		t.Fatalf("unexpected race execution: createCalls=%d stored=%v", createCalls, stored)
	}
}

func TestExecuteIdempotentDoesNotHideOtherFailures(t *testing.T) {
	createErr := errors.New("connection lost")
	err := executeIdempotent(func() (bool, error) { return false, nil }, func() error { return createErr }, isDuplicateKey)
	if !errors.Is(err, createErr) {
		t.Fatalf("unexpected error: %v", err)
	}
	lookupErr := fmt.Errorf("winner lookup failed")
	err = executeIdempotent(
		func() (bool, error) { return false, lookupErr },
		func() error { return nil }, isDuplicateKey,
	)
	if !errors.Is(err, lookupErr) {
		t.Fatalf("lookup error was hidden: %v", err)
	}
}

func TestDuplicateKeyDetection(t *testing.T) {
	duplicate := fmt.Errorf("insert: %w", &mysqlDriver.MySQLError{Number: 1062})
	if !isDuplicateKey(duplicate) {
		t.Fatal("wrapped MySQL duplicate-key error not detected")
	}
	if isDuplicateKey(&mysqlDriver.MySQLError{Number: 1213}) || isDuplicateKey(errors.New("other")) {
		t.Fatal("non-duplicate error incorrectly treated as idempotency race")
	}
}
