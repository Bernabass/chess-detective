//go:build !webui

package webui

import "net/http"

// Embedded is nil in builds without the web app (development, tests, Vercel): the Vite dev
// server or the CDN serves it.
func Embedded() http.Handler { return nil }
