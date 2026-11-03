package httpapi

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
	"testing"
)

func TestClientIP(t *testing.T) {
	proxies := []netip.Prefix{netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("::1/128")}
	cases := []struct {
		name, peer string
		xff        []string
		trusted    []netip.Prefix
		want       string
	}{
		{"no proxies: the peer", "203.0.113.7:5000", nil, nil, "203.0.113.7"},
		{"untrusted peer: a spoofed header is ignored", "203.0.113.7:5000", []string{"1.2.3.4"}, proxies, "203.0.113.7"},
		{"no proxies configured: header ignored", "10.0.0.1:5000", []string{"1.2.3.4"}, nil, "10.0.0.1"},
		{"trusted peer: the right-most untrusted hop", "10.0.0.1:5000", []string{"6.6.6.6, 198.51.100.9, 10.0.0.2"}, proxies, "198.51.100.9"},
		{"several headers are one list", "10.0.0.1:5000", []string{"6.6.6.6", "198.51.100.9"}, proxies, "198.51.100.9"},
		{"all hops trusted: the peer", "10.0.0.1:5000", []string{"10.0.0.3, 10.0.0.2"}, proxies, "10.0.0.1"},
		{"a malformed hop stops the walk", "10.0.0.1:5000", []string{"198.51.100.9, garbage"}, proxies, "10.0.0.1"},
		{"no header from a trusted peer", "10.0.0.1:5000", nil, proxies, "10.0.0.1"},
		{"IPv4-mapped IPv6 peer", "[::ffff:10.0.0.1]:5000", []string{"198.51.100.9"}, proxies, "198.51.100.9"},
		{"IPv6 trusted peer", "[::1]:5000", []string{"2001:db8::5"}, proxies, "2001:db8::5"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequestWithContext(t.Context(), "GET", "/api/daily", nil)
			r.RemoteAddr = c.peer
			for _, v := range c.xff {
				r.Header.Add("X-Forwarded-For", v)
			}
			if got := clientIP(r, c.trusted, ""); got.String() != c.want {
				t.Errorf("clientIP = %s, want %s", got, c.want)
			}
		})
	}
}

// On a platform that overwrites a client-IP header (Vercel's X-Real-IP), that header is the
// client and nothing the client sends can change it.
func TestClientIPFromPlatformHeader(t *testing.T) {
	cases := []struct {
		name   string
		header string
		xff    string
		want   string
	}{
		{"the header", "198.51.100.9", "", "198.51.100.9"},
		{"a forged X-Forwarded-For is ignored", "198.51.100.9", "1.2.3.4", "198.51.100.9"},
		{"the first entry of a list", "198.51.100.9, 10.0.0.1", "", "198.51.100.9"},
		{"spaces", "  2001:db8::5 ", "", "2001:db8::5"},
		{"IPv4-mapped", "::ffff:198.51.100.9", "", "198.51.100.9"},
		{"missing header: the peer", "", "1.2.3.4", "10.9.8.7"},
		{"malformed header: the peer", "not-an-ip", "", "10.9.8.7"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequestWithContext(t.Context(), "GET", "/api/daily", nil)
			r.RemoteAddr = "10.9.8.7:5000"
			if c.header != "" {
				r.Header.Set("X-Real-Ip", c.header)
			}
			if c.xff != "" {
				r.Header.Set("X-Forwarded-For", c.xff)
			}
			if got := clientIP(r, nil, "X-Real-Ip"); got.String() != c.want {
				t.Errorf("clientIP = %s, want %s", got, c.want)
			}
		})
	}
}

// A deployment's other addresses (a Vercel preview's deployment URL) are accepted origins too.
func TestCSRFCheckAcceptsEveryOriginOfThisDeployment(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	h := withCSRFCheck(mustURL(t, "https://retrograde-chess-git-x.vercel.app"), []string{"https://retrograde-chess-abc.vercel.app"}, ok)
	for origin, want := range map[string]int{
		"https://retrograde-chess-git-x.vercel.app": http.StatusNoContent,
		"https://retrograde-chess-abc.vercel.app":   http.StatusNoContent,
		"https://evil.example":                      http.StatusForbidden,
		"":                                          http.StatusForbidden,
	} {
		r := httptest.NewRequestWithContext(t.Context(), "POST", "/api/auth/logout", nil)
		r.Header.Set("Content-Type", "application/json")
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != want {
			t.Errorf("Origin %q: status %d, want %d", origin, w.Code, want)
		}
	}
}

func TestCSRFOriginIgnoresDefaultPort(t *testing.T) {
	for base, want := range map[string]string{
		"https://retrograde.example:443": "https://retrograde.example",
		"http://localhost:80":            "http://localhost",
		"http://localhost:5173":          "http://localhost:5173",
		"https://Retrograde.Example":     "https://retrograde.example",
	} {
		if got := originOf(mustURL(t, base)); got != want {
			t.Errorf("originOf(%s) = %s, want %s", base, got, want)
		}
	}
}

func mustURL(t *testing.T, s string) *url.URL {
	t.Helper()
	u, err := url.Parse(s)
	if err != nil {
		t.Fatal(err)
	}
	return u
}
