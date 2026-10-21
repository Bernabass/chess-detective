package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeDB struct {
	err   error
	block bool // wait for the context to end, like a database that doesn't answer
}

func (f fakeDB) Ping(ctx context.Context) error {
	if f.block {
		<-ctx.Done()
		return ctx.Err()
	}
	return f.err
}

func newTestHandler(db Pinger) http.Handler {
	return NewHandler(Options{
		Logger:        slog.New(slog.DiscardHandler),
		DB:            db,
		HealthTimeout: 50 * time.Millisecond,
	})
}

func get(t *testing.T, h http.Handler, path string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil))
	return rec
}

func TestHealth(t *testing.T) {
	tests := []struct {
		name       string
		db         fakeDB
		wantStatus int
		want       Health
	}{
		{"database answers", fakeDB{}, http.StatusOK, Health{Status: HealthStatusOk, Db: HealthDbOk}},
		{"database errors", fakeDB{err: errors.New("connection refused")}, http.StatusServiceUnavailable,
			Health{Status: HealthStatusUnavailable, Db: HealthDbError}},
		{"database times out", fakeDB{block: true}, http.StatusServiceUnavailable,
			Health{Status: HealthStatusUnavailable, Db: HealthDbError}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := get(t, newTestHandler(tt.db), "/api/health")
			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tt.wantStatus)
			}
			if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
				t.Errorf("Content-Type = %q", ct)
			}
			var got Health
			dec := json.NewDecoder(rec.Body)
			dec.DisallowUnknownFields()
			if err := dec.Decode(&got); err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Errorf("body = %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestHealthErrorDetailsAreNotSent(t *testing.T) {
	rec := get(t, newTestHandler(fakeDB{err: errors.New("password authentication failed for user bob")}), "/api/health")
	body, _ := io.ReadAll(rec.Body)
	if want := `{"db":"error","status":"unavailable"}` + "\n"; string(body) != want {
		t.Errorf("body = %q, want %q", body, want)
	}
}

func TestUnknownAPIPathIsProblemJSON(t *testing.T) {
	rec := get(t, newTestHandler(fakeDB{}), "/api/nope")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	assertProblem(t, rec, http.StatusNotFound)
}

func TestWrongMethodIs405WithAllow(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/health", nil)
	newTestHandler(fakeDB{}).ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", rec.Code)
	}
	if allow := rec.Header().Get("Allow"); !strings.Contains(allow, http.MethodGet) {
		t.Errorf("Allow = %q, want it to list GET", allow)
	}
	assertProblem(t, rec, http.StatusMethodNotAllowed)
}

func TestHandlerLogLinesCarryRequestID(t *testing.T) {
	var buf bytes.Buffer
	h := NewHandler(Options{
		Logger:        slog.New(slog.NewJSONHandler(&buf, nil)),
		DB:            fakeDB{err: errors.New("down")},
		HealthTimeout: 50 * time.Millisecond,
	})
	rec := get(t, h, "/api/health")
	id := rec.Header().Get("X-Request-Id")

	// Two lines: the handler's warning, then the access log line.
	lines := strings.Split(strings.TrimSpace(buf.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("got %d log lines, want 2:\n%s", len(lines), buf.String())
	}
	for _, line := range lines {
		var entry struct {
			Msg       string `json:"msg"`
			RequestID string `json:"request_id"`
		}
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatal(err)
		}
		if entry.RequestID != id {
			t.Errorf("log line %q has request_id %q, want %q", entry.Msg, entry.RequestID, id)
		}
	}
}

func TestRequestIDHeader(t *testing.T) {
	h := newTestHandler(fakeDB{})
	first := get(t, h, "/api/health").Header().Get("X-Request-Id")
	second := get(t, h, "/api/health").Header().Get("X-Request-Id")
	if len(first) != 16 || first == second {
		t.Errorf("request ids %q and %q should be distinct 16-char hex strings", first, second)
	}
}

func TestRecoverTurnsPanicInto500(t *testing.T) {
	h := withRecover(slog.New(slog.DiscardHandler), http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("boom")
	}))
	rec := get(t, h, "/api/anything")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	assertProblem(t, rec, http.StatusInternalServerError)
}

func TestLoggingRecordsStatus(t *testing.T) {
	var logged struct {
		Status    int    `json:"status"`
		Path      string `json:"path"`
		RequestID string `json:"request_id"`
	}
	pr, pw := io.Pipe()
	logger := withRequestIDLogging(slog.New(slog.NewJSONHandler(pw, nil)))
	h := withRequestID(withLogging(logger, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	})))
	done := make(chan error, 1)
	go func() { done <- json.NewDecoder(pr).Decode(&logged) }()
	rec := get(t, h, "/api/tea?secret=x")
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if logged.Status != http.StatusTeapot || logged.Path != "/api/tea" {
		t.Errorf("logged %+v, want status 418 and path without query", logged)
	}
	if logged.RequestID != rec.Header().Get("X-Request-Id") {
		t.Errorf("logged request id %q, header %q", logged.RequestID, rec.Header().Get("X-Request-Id"))
	}
}

func assertProblem(t *testing.T, rec *httptest.ResponseRecorder, status int) {
	t.Helper()
	if ct := rec.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Errorf("Content-Type = %q, want application/problem+json", ct)
	}
	var p problem
	if err := json.NewDecoder(rec.Body).Decode(&p); err != nil {
		t.Fatal(err)
	}
	if p.Status != status || p.Title != http.StatusText(status) {
		t.Errorf("problem = %+v", p)
	}
}
