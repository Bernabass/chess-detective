// Package webui serves the built web app (apps/web/dist) from the Go binary, for the container
// image and `pnpm start` (ARCHITECTURE.md §11.5). On Vercel the CDN serves it instead, with the
// same headers from vercel.json.
package webui

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// Header is one response header.
type Header struct{ Key, Value string }

// PageHeaders are the security headers of every web app response. vercel.json sets the same
// ones on Vercel; a test keeps the two identical.
func PageHeaders() []Header {
	return []Header{
		{"Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
			"font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; " +
			"form-action 'self'; frame-ancestors 'none'"},
		{"X-Content-Type-Options", "nosniff"},
		{"Referrer-Policy", "strict-origin-when-cross-origin"},
		{"X-Frame-Options", "DENY"},
		{"Permissions-Policy", "camera=(), microphone=(), geolocation=()"},
		{"Strict-Transport-Security", "max-age=63072000"},
	}
}

// Cache policies: Vite's hashed files under /assets never change; everything else (index.html,
// theme-init.js, the favicon) is revalidated on every load, so a new release shows at once.
const (
	CacheImmutable  = "public, max-age=31536000, immutable"
	CacheRevalidate = "no-cache"
)

// Handler serves dist. A path that isn't a file gets index.html, so client routes such as
// /daily/3 load the app; a missing file with an extension (/assets/old.js) is a 404 instead,
// never HTML in place of a script.
func Handler(dist fs.FS) http.Handler {
	files := http.FileServerFS(dist)
	headers := PageHeaders()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, h := range headers {
			w.Header().Set(h.Key, h.Value)
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name != "" && isFile(dist, name) {
			if strings.HasPrefix(name, "assets/") {
				w.Header().Set("Cache-Control", CacheImmutable)
			} else {
				w.Header().Set("Cache-Control", CacheRevalidate)
			}
			files.ServeHTTP(w, r)
			return
		}
		if path.Ext(name) != "" {
			w.Header().Set("Cache-Control", CacheRevalidate)
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", CacheRevalidate)
		http.ServeFileFS(w, r, dist, "index.html")
	})
}

func isFile(fsys fs.FS, name string) bool {
	info, err := fs.Stat(fsys, name)
	return err == nil && !info.IsDir()
}
