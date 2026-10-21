//go:build integration

package httpapi_test

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Bernabass/chess-detective/services/api/internal/dbtest"
	"github.com/Bernabass/chess-detective/services/api/internal/httpapi"
	"github.com/Bernabass/chess-detective/services/api/internal/store"
)

func TestHealthAgainstRealDatabase(t *testing.T) {
	st, err := store.Open(t.Context(), dbtest.URL(t))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	srv := httptest.NewServer(httpapi.NewHandler(httpapi.Options{Logger: slog.New(slog.DiscardHandler), DB: st}))
	defer srv.Close()

	req, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/api/health", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	var body httpapi.Health
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Status != httpapi.HealthStatusOk || body.Db != httpapi.HealthDbOk {
		t.Errorf("body = %+v, want ok/ok", body)
	}
}
