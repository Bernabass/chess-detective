package httpapi

import (
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
)

// maxBodyBytes bounds every request body (SPEC §11.1).
const maxBodyBytes = 16 << 10

// withSecurityHeaders sets the API's security headers. API responses are never cached.
func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		h.Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// withBodyLimit caps request bodies; a larger body fails to decode (400).
func withBodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
		next.ServeHTTP(w, r)
	})
}

// withCSRFCheck rejects state-changing requests that don't send JSON from our own origin
// (SPEC §10.6). Together with SameSite=Lax cookies this stops cross-site forms and fetches.
func withCSRFCheck(baseURL *url.URL, next http.Handler) http.Handler {
	origin := originOf(baseURL)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || mediaType != "application/json" {
			writeProblem(w, http.StatusUnsupportedMediaType, "State-changing requests must send Content-Type: application/json.")
			return
		}
		if r.Header.Get("Origin") != origin {
			writeProblem(w, http.StatusForbidden, "The request's Origin header must be this site's address.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// originOf is the Origin header a browser sends for pages at u: lower-case scheme and host,
// and no port when it's the scheme's default.
func originOf(u *url.URL) string {
	scheme, host, port := strings.ToLower(u.Scheme), strings.ToLower(u.Hostname()), u.Port()
	if strings.Contains(host, ":") {
		host = "[" + host + "]" // IPv6
	}
	defaultPort := (scheme == "http" && port == "80") || (scheme == "https" && port == "443")
	if port != "" && !defaultPort {
		host += ":" + port
	}
	return scheme + "://" + host
}

// clientIP is the TCP peer, or the right-most X-Forwarded-For address that isn't a trusted
// proxy when the peer itself is one (SPEC §10.2).
func clientIP(r *http.Request, trusted []netip.Prefix) netip.Addr {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return netip.Addr{}
	}
	peer = peer.Unmap()
	if !isTrusted(peer, trusted) {
		return peer
	}
	hops := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	for i := len(hops) - 1; i >= 0; i-- {
		addr, err := netip.ParseAddr(strings.TrimSpace(hops[i]))
		if err != nil {
			break
		}
		addr = addr.Unmap()
		if !isTrusted(addr, trusted) {
			return addr
		}
	}
	return peer
}

func isTrusted(addr netip.Addr, trusted []netip.Prefix) bool {
	for _, p := range trusted {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}
