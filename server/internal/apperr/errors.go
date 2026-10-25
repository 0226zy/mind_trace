package apperr

import "net/http"

type AppError struct {
	Status  int
	Code    string
	Message string
}

func (e *AppError) Error() string { return e.Message }

func BadRequest(message string) *AppError {
	return &AppError{Status: http.StatusBadRequest, Code: "INVALID_INPUT", Message: message}
}
func Unauthorized(message string) *AppError {
	return &AppError{Status: http.StatusUnauthorized, Code: "UNAUTHORIZED", Message: message}
}
func NotFound() *AppError {
	return &AppError{Status: http.StatusNotFound, Code: "NOT_FOUND", Message: "resource not found"}
}
func Conflict(message string) *AppError {
	return &AppError{Status: http.StatusConflict, Code: "CONFLICT", Message: message}
}
