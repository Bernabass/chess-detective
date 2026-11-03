// Package config reads and validates the API's settings (ARCHITECTURE.md §10.2).
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Config holds validated settings.
type Config struct {
	DatabaseURL string
	Host        string
	Port        int
	BaseURL     *url.URL
	LogLevel    slog.Level
	// LaunchDate is puzzle #1's day (UTC); number = days since LaunchDate + 1.
	LaunchDate time.Time
	// CookieSecure marks the session cookie Secure (production, behind HTTPS).
	CookieSecure bool
	// TrustedProxies: X-Forwarded-For is honoured only from these peers.
	TrustedProxies []netip.Prefix
	// RateLimitScale multiplies every rate limit (1 in production; the e2e tests raise it).
	RateLimitScale int
	// LichessBaseURL is where Sign in with Lichess goes (a fake server in tests), without a
	// trailing slash.
	LichessBaseURL *url.URL
	// LichessClientID identifies this app to Lichess (no registration; any unique id).
	// Defaults to BASE_URL's host.
	LichessClientID string

	// Production is APP_ENV=production, or running on Vercel: serve then refuses unsafe
	// settings (ProductionProblems).
	Production bool
	// OnVercel is VERCEL=1, set by the platform.
	OnVercel bool
	// LaunchDateSet is whether LAUNCH_DATE was given rather than defaulted.
	LaunchDateSet bool
	// ExtraOrigins are other origins of this same deployment accepted by the CSRF check, such as
	// a Vercel deployment's own address next to its branch or production address.
	ExtraOrigins []string
	// CronSecret authorizes GET /api/internal/cleanup (Vercel sends it as a bearer token).
	// Empty disables the endpoint.
	CronSecret string
	// ClientIPHeader names a header the platform sets to the client's IP and that clients can't
	// forge (Vercel: X-Real-IP). Empty: the TCP peer, or X-Forwarded-For from TrustedProxies.
	ClientIPHeader string
	// CleanupInProcess runs the cleanup job inside serve every hour. Off on Vercel, where
	// instances pause between requests and a daily cron calls the cleanup endpoint instead.
	CleanupInProcess bool
}

// maxRateLimitScale keeps the multiplied limits far from integer overflow.
const maxRateLimitScale = 1_000_000

// DefaultLaunchDate is the planned launch (ARCHITECTURE.md §10.2).
const DefaultLaunchDate = "2026-11-01"

// Addr is the address the HTTP server listens on.
func (c Config) Addr() string {
	return net.JoinHostPort(c.Host, strconv.Itoa(c.Port)) // brackets IPv6 hosts
}

// ErrMissingDatabaseURL is returned when DATABASE_URL is not set anywhere.
var ErrMissingDatabaseURL = errors.New(
	"DATABASE_URL is not set: copy .env.example to .env in the project folder " +
		"and fill in your PostgreSQL username and password")

// Load validates the settings. Every problem is reported at once.
func Load(lookup Lookup) (Config, error) {
	get := func(key, fallback string) string {
		if v, ok := lookup(key); ok && strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
		return fallback
	}

	var errs []error
	onVercel := get("VERCEL", "") == "1"
	defaultHost := "127.0.0.1"
	if onVercel {
		defaultHost = "0.0.0.0" // the platform proxies to the server
	}
	cfg := Config{
		DatabaseURL:      get("DATABASE_URL", ""),
		Host:             get("HOST", defaultHost),
		OnVercel:         onVercel,
		CleanupInProcess: !onVercel,
		CronSecret:       get("CRON_SECRET", ""),
	}

	switch strings.ToLower(get("APP_ENV", "development")) {
	case "production":
		cfg.Production = true
	case "development":
	default:
		errs = append(errs, fmt.Errorf("APP_ENV must be development or production, got %q", get("APP_ENV", "")))
	}
	cfg.Production = cfg.Production || onVercel

	if cfg.DatabaseURL == "" {
		errs = append(errs, ErrMissingDatabaseURL)
	}

	port, err := strconv.Atoi(get("PORT", "8080"))
	if err != nil || port < 1 || port > 65535 {
		errs = append(errs, fmt.Errorf("PORT must be a number from 1 to 65535, got %q", get("PORT", "")))
	}
	cfg.Port = port

	defaultBase, extraHosts := vercelAddresses(get)
	baseURL, err := url.Parse(get("BASE_URL", defaultBase))
	if err != nil || (baseURL.Scheme != "http" && baseURL.Scheme != "https") || baseURL.Host == "" {
		errs = append(errs, fmt.Errorf("BASE_URL must be an absolute http(s) URL, got %q", get("BASE_URL", "")))
	}
	cfg.BaseURL = baseURL
	for _, host := range extraHosts {
		if baseURL == nil || !strings.EqualFold(host, baseURL.Host) {
			cfg.ExtraOrigins = append(cfg.ExtraOrigins, "https://"+strings.ToLower(host))
		}
	}

	if err := cfg.LogLevel.UnmarshalText([]byte(get("LOG_LEVEL", "info"))); err != nil {
		errs = append(errs, fmt.Errorf("LOG_LEVEL must be debug, info, warn or error, got %q", get("LOG_LEVEL", "")))
	}

	launch, err := time.Parse(time.DateOnly, get("LAUNCH_DATE", DefaultLaunchDate))
	if err != nil {
		errs = append(errs, fmt.Errorf("LAUNCH_DATE must be a date like 2026-11-01, got %q", get("LAUNCH_DATE", "")))
	}
	cfg.LaunchDate = launch
	cfg.LaunchDateSet = get("LAUNCH_DATE", "") != ""

	switch strings.ToLower(get("COOKIE_SECURE", "false")) {
	case "true", "1", "yes":
		cfg.CookieSecure = true
	case "false", "0", "no":
	default:
		errs = append(errs, fmt.Errorf("COOKIE_SECURE must be true or false, got %q", get("COOKIE_SECURE", "")))
	}

	scale, err := strconv.Atoi(get("RATE_LIMIT_SCALE", "1"))
	if err != nil || scale < 1 || scale > maxRateLimitScale {
		errs = append(errs, fmt.Errorf("RATE_LIMIT_SCALE must be a whole number from 1 to %d, got %q", maxRateLimitScale, get("RATE_LIMIT_SCALE", "")))
	}
	cfg.RateLimitScale = scale

	lichess, err := url.Parse(strings.TrimSuffix(get("LICHESS_BASE_URL", "https://lichess.org"), "/"))
	if err != nil || (lichess.Scheme != "http" && lichess.Scheme != "https") || lichess.Host == "" {
		errs = append(errs, fmt.Errorf("LICHESS_BASE_URL must be an absolute http(s) URL, got %q", get("LICHESS_BASE_URL", "")))
	}
	cfg.LichessBaseURL = lichess
	cfg.LichessClientID = get("LICHESS_CLIENT_ID", "")
	if cfg.LichessClientID == "" && baseURL != nil {
		cfg.LichessClientID = baseURL.Host
	}

	proxies, err := parseProxies(get("TRUSTED_PROXIES", ""))
	if err != nil {
		errs = append(errs, err)
	}
	cfg.TrustedProxies = proxies

	if header := get("CLIENT_IP_HEADER", ""); header != "" {
		if !isToken(header) {
			errs = append(errs, fmt.Errorf("CLIENT_IP_HEADER must be a header name like X-Real-IP, got %q", header))
		}
		if len(proxies) > 0 {
			errs = append(errs, errors.New("set either CLIENT_IP_HEADER or TRUSTED_PROXIES, not both"))
		}
		cfg.ClientIPHeader = textproto.CanonicalMIMEHeaderKey(header)
	}

	if len(errs) > 0 {
		return Config{}, errors.Join(errs...)
	}
	return cfg, nil
}

// vercelAddresses is the default BASE_URL on Vercel (the production domain in production, the
// deployment's own address otherwise: unique to that deployment, unlike a branch alias that a
// later deployment can take over) and the deployment's other addresses, which the CSRF check also
// accepts. Off Vercel: the development address and nothing else.
func vercelAddresses(get func(key, fallback string) string) (string, []string) {
	if get("VERCEL", "") != "1" {
		return "http://localhost:5173", nil
	}
	deployment, branch, prod := get("VERCEL_URL", ""), get("VERCEL_BRANCH_URL", ""), get("VERCEL_PROJECT_PRODUCTION_URL", "")
	primary := deployment
	if get("VERCEL_ENV", "") == "production" && prod != "" {
		primary = prod
	}
	if primary == "" {
		return "http://localhost:5173", nil
	}
	var extra []string
	for _, h := range []string{deployment, branch} {
		if h != "" && h != primary {
			extra = append(extra, h)
		}
	}
	return "https://" + primary, extra
}

// isToken reports whether s is a valid HTTP header name (an RFC 9110 token).
func isToken(s string) bool {
	tokenChar := func(r rune) bool {
		return r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("!#$%&'*+-.^_`|~", r)
	}
	for _, r := range s {
		if !tokenChar(r) {
			return false
		}
	}
	return s != ""
}

// parseProxies reads a comma-separated list of IPs and CIDRs.
func parseProxies(list string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, item := range strings.Split(list, ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if p, err := netip.ParsePrefix(item); err == nil {
			out = append(out, p.Masked())
			continue
		}
		addr, err := netip.ParseAddr(item)
		if err != nil {
			return nil, fmt.Errorf("TRUSTED_PROXIES must list IPs or CIDRs separated by commas, got %q", item)
		}
		out = append(out, netip.PrefixFrom(addr, addr.BitLen()))
	}
	return out, nil
}
