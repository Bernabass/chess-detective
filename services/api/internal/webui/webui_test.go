package webui

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"testing/fstest"
)

var dist = fstest.MapFS{
	"index.html":              {Data: []byte("<!doctype html><title>Retrograde</title>")},
	"theme-init.js":           {Data: []byte("// theme")},
	"assets/index-abc123.js":  {Data: []byte("console.log(1)")},
	"assets/index-abc123.css": {Data: []byte("body{}")},
}

func get(t *testing.T, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	Handler(dist).ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), method, target, nil))
	return w
}

func TestServesFilesWithTheirCachePolicy(t *testing.T) {
	for target, want := range map[string]string{
		"/assets/index-abc123.js":  CacheImmutable,
		"/assets/index-abc123.css": CacheImmutable,
		"/theme-init.js":           CacheRevalidate,
	} {
		w := get(t, http.MethodGet, target)
		if w.Code != http.StatusOK || w.Header().Get("Cache-Control") != want {
			t.Errorf("%s: %d, Cache-Control %q, want 200 and %q", target, w.Code, w.Header().Get("Cache-Control"), want)
		}
	}
}

func TestClientRoutesGetTheApp(t *testing.T) {
	for _, target := range []string{"/", "/daily", "/daily/3", "/u/someone", "/lab?fen=8/8/8/8/8/8/8/K6k%20w%20-%20-"} {
		w := get(t, http.MethodGet, target)
		if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "<title>Retrograde</title>") {
			t.Errorf("%s: %d %q, want index.html", target, w.Code, w.Body.String())
		}
		if w.Header().Get("Cache-Control") != CacheRevalidate {
			t.Errorf("%s: Cache-Control %q", target, w.Header().Get("Cache-Control"))
		}
	}
}

func TestMissingFilesAreNotFound(t *testing.T) {
	for _, target := range []string{"/assets/index-old.js", "/robots.txt", "/../../etc/passwd.txt"} {
		if w := get(t, http.MethodGet, target); w.Code != http.StatusNotFound {
			t.Errorf("%s: %d, want 404", target, w.Code)
		}
	}
}

func TestOnlyGetAndHead(t *testing.T) {
	if w := get(t, http.MethodHead, "/daily"); w.Code != http.StatusOK {
		t.Errorf("HEAD: %d", w.Code)
	}
	if w := get(t, http.MethodPost, "/daily"); w.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST: %d, want 405", w.Code)
	}
}

func TestEveryResponseHasThePageHeaders(t *testing.T) {
	for _, target := range []string{"/", "/assets/index-abc123.js", "/assets/missing.js"} {
		w := get(t, http.MethodGet, target)
		for _, h := range PageHeaders() {
			if w.Header().Get(h.Key) != h.Value {
				t.Errorf("%s: %s = %q", target, h.Key, w.Header().Get(h.Key))
			}
		}
	}
}

// vercel.json gives the web app on Vercel the same headers as this package does elsewhere.
func TestVercelConfigHasTheSamePageHeaders(t *testing.T) {
	raw, err := os.ReadFile("../../../../vercel.json")
	if err != nil {
		t.Fatal(err)
	}
	var cfg struct {
		Services map[string]struct {
			Headers []struct {
				Source  string `json:"source"`
				Headers []struct {
					Key   string `json:"key"`
					Value string `json:"value"`
				} `json:"headers"`
			} `json:"headers"`
		} `json:"services"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatal(err)
	}
	var got []Header
	for _, rule := range cfg.Services["web"].Headers {
		if rule.Source == "/(.*)" {
			for _, h := range rule.Headers {
				got = append(got, Header{h.Key, h.Value})
			}
		}
	}
	want := PageHeaders()
	if len(got) != len(want) {
		t.Fatalf("vercel.json has %d page headers, want %d: %v", len(got), len(want), got)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("header %d: vercel.json %v, webui %v", i, got[i], want[i])
		}
	}
}
