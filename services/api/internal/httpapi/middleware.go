package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"
)

type ctxKey int

const requestIDKey ctxKey = iota

// RequestID returns the request's ID, or "" outside a request.
func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey).(string)
	return id
}

// withRequestID gives every request a random ID, returned in the X-Request-Id header and logged.
func withRequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 8)
		_, _ = rand.Read(buf) // crypto/rand.Read never fails
		id := hex.EncodeToString(buf)
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), requestIDKey, id)))
	})
}

// requestIDHandler adds request_id to every log record made with a request's context,
// so handler log lines can be matched to the access log line.
type requestIDHandler struct {
	slog.Handler
}

func withRequestIDLogging(logger *slog.Logger) *slog.Logger {
	return slog.New(requestIDHandler{logger.Handler()})
}

func (h requestIDHandler) Handle(ctx context.Context, r slog.Record) error {
	if id := RequestID(ctx); id != "" {
		r.AddAttrs(slog.String("request_id", id))
	}
	return h.Handler.Handle(ctx, r) //nolint:wrapcheck // transparent wrapper
}

func (h requestIDHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return requestIDHandler{h.Handler.WithAttrs(attrs)}
}

func (h requestIDHandler) WithGroup(name string) slog.Handler {
	return requestIDHandler{h.Handler.WithGroup(name)}
}

// withProblemFallback answers requests that match no route as problem+json.
// It keeps ServeMux's own status (404, or 405 for a known path with the wrong
// method) and its Allow header.
func withProblemFallback(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fallback, pattern := mux.Handler(r)
		if pattern != "" {
			mux.ServeHTTP(w, r)
			return
		}
		probe := &headerProbe{header: http.Header{}, status: http.StatusOK}
		fallback.ServeHTTP(probe, r)
		if allow := probe.header.Get("Allow"); allow != "" {
			w.Header().Set("Allow", allow)
		}
		writeProblem(w, probe.status, "")
	})
}

// headerProbe records what a handler would send, discarding the body.
type headerProbe struct {
	header http.Header
	status int
}

func (p *headerProbe) Header() http.Header         { return p.header }
func (p *headerProbe) WriteHeader(status int)      { p.status = status }
func (p *headerProbe) Write(b []byte) (int, error) { return len(b), nil }

// statusRecorder captures the status code for the access log.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	if s.status == 0 {
		s.status = code
	}
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusRecorder) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	return s.ResponseWriter.Write(b) //nolint:wrapcheck // transparent wrapper
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (s *statusRecorder) Unwrap() http.ResponseWriter {
	return s.ResponseWriter
}

// withLogging writes one structured log line per request. It logs the path
// without the query string, so nothing sensitive in a query ends up in logs.
func withLogging(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)
		if rec.status == 0 {
			rec.status = http.StatusOK
		}
		logger.InfoContext(r.Context(), "request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration_ms", time.Since(start).Milliseconds(),
		)
	})
}

// withRecover turns a panic into a 500 problem response instead of a dropped connection.
func withRecover(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			v := recover()
			if v == nil {
				return
			}
			if v == http.ErrAbortHandler { //nolint:errorlint // sentinel value compared as net/http does
				panic(v)
			}
			logger.ErrorContext(r.Context(), "panic", "value", v)
			writeProblem(w, http.StatusInternalServerError, "")
		}()
		next.ServeHTTP(w, r)
	})
}

// problem is an RFC 9457 problem details body.
type problem struct {
	Type   string `json:"type"`
	Title  string `json:"title"`
	Status int    `json:"status"`
	Detail string `json:"detail,omitempty"`
}

// writeProblem sends an application/problem+json error. detail must never contain internal error text.
func writeProblem(w http.ResponseWriter, status int, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(problem{
		Type:   "about:blank",
		Title:  http.StatusText(status),
		Status: status,
		Detail: detail,
	})
}
