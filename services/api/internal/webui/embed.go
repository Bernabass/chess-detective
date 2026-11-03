//go:build webui

package webui

import (
	"embed"
	"io/fs"
	"net/http"
)

// The build copies apps/web/dist here before compiling with -tags webui (go:embed can't read
// outside the module).
//
//go:embed all:dist
var embedded embed.FS

// Embedded is the web app built into this binary.
func Embedded() http.Handler {
	dist, err := fs.Sub(embedded, "dist")
	if err != nil {
		panic(err) // the directory is embedded above; failing here is a build bug
	}
	return Handler(dist)
}
