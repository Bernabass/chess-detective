package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	nethttpmiddleware "github.com/oapi-codegen/nethttp-middleware"
)

// newRequestValidator checks every request against api/openapi.yaml (embedded at generation
// time): unknown JSON fields, lengths, patterns, enums, parameter types. It runs on matched
// routes only, so unknown paths and methods keep ServeMux's 404 and 405.
func newRequestValidator() (func(http.Handler) http.Handler, error) {
	spec, err := GetSwagger()
	if err != nil {
		return nil, fmt.Errorf("loading the embedded OpenAPI spec: %w", err)
	}
	// Paths in the spec are relative to the /api server; the Prefix option trims it.
	spec.Servers = openapi3.Servers{}
	return nethttpmiddleware.OapiRequestValidatorWithOptions(spec, &nethttpmiddleware.Options{
		Prefix:               "/api",
		DoNotValidateServers: true,
		Options: openapi3filter.Options{
			// Sessions are checked by the handlers, not by the validator.
			AuthenticationFunc: openapi3filter.NoopAuthenticationFunc,
			// Report the first problem; it's enough to fix the request.
			MultiError: false,
		},
		ErrorHandlerWithOpts: func(_ context.Context, err error, w http.ResponseWriter, _ *http.Request, opts nethttpmiddleware.ErrorHandlerOpts) {
			status := opts.StatusCode
			if status == 0 {
				status = http.StatusBadRequest
			}
			writeProblem(w, status, validationDetail(err))
		},
	}), nil
}

// validationDetail is a short, safe description of what's wrong with the request (it only
// talks about the request, never about the server).
func validationDetail(err error) string {
	var reqErr *openapi3filter.RequestError
	if errors.As(err, &reqErr) {
		var schemaErr *openapi3.SchemaError
		if errors.As(reqErr.Err, &schemaErr) {
			where := "the request body"
			if reqErr.Parameter != nil {
				where = "parameter " + reqErr.Parameter.Name
			}
			path := schemaErr.JSONPointer()
			if len(path) > 0 {
				where += " at /" + joinPointer(path)
			}
			return fmt.Sprintf("Invalid %s: %s", where, schemaErr.Reason)
		}
		if reqErr.Parameter != nil {
			return fmt.Sprintf("Invalid parameter %s: %s", reqErr.Parameter.Name, reqErr.Reason)
		}
		if reqErr.Reason != "" {
			return "Invalid request: " + reqErr.Reason
		}
	}
	return "The request doesn't match the API contract."
}

func joinPointer(path []string) string {
	out := ""
	for i, p := range path {
		if i > 0 {
			out += "/"
		}
		out += p
	}
	return out
}
