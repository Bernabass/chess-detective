package httpapi

import (
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
			if got := clientIP(r, c.trusted); got.String() != c.want {
				t.Errorf("clientIP = %s, want %s", got, c.want)
			}
		})
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
