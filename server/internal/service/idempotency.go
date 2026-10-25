package service

import (
	"errors"
	"strings"

	mysqlDriver "github.com/go-sql-driver/mysql"
)

func normalizeClientRequestID(raw *string) (*string, error) {
	if raw == nil {
		return nil, nil
	}
	value := strings.TrimSpace(*raw)
	if err := validateText("clientRequestId", value, 1, 64); err != nil {
		return nil, err
	}
	return &value, nil
}

func isDuplicateKey(err error) bool {
	var mysqlErr *mysqlDriver.MySQLError
	return errors.As(err, &mysqlErr) && mysqlErr.Number == 1062
}

// executeIdempotent handles both a retry after commit and a concurrent insert
// that loses the unique-key race. The losing transaction rolls back, then the
// lookup loads the winner's committed result instead of returning a conflict.
func executeIdempotent(lookup func() (bool, error), create func() error, isDuplicate func(error) bool) error {
	found, err := lookup()
	if err != nil || found {
		return err
	}
	createErr := create()
	if createErr == nil || !isDuplicate(createErr) {
		return createErr
	}
	found, err = lookup()
	if err != nil {
		return err
	}
	if !found {
		return createErr
	}
	return nil
}
