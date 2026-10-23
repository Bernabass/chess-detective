// Package config reads and validates the API's settings (SPEC §10.2).
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
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
}

// DefaultLaunchDate is the planned launch (SPEC §10.2).
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
	cfg := Config{
		DatabaseURL: get("DATABASE_URL", ""),
		Host:        get("HOST", "127.0.0.1"),
	}

	if cfg.DatabaseURL == "" {
		errs = append(errs, ErrMissingDatabaseURL)
	}

	port, err := strconv.Atoi(get("PORT", "8080"))
	if err != nil || port < 1 || port > 65535 {
		errs = append(errs, fmt.Errorf("PORT must be a number from 1 to 65535, got %q", get("PORT", "")))
	}
	cfg.Port = port

	baseURL, err := url.Parse(get("BASE_URL", "http://localhost:5173"))
	if err != nil || (baseURL.Scheme != "http" && baseURL.Scheme != "https") || baseURL.Host == "" {
		errs = append(errs, fmt.Errorf("BASE_URL must be an absolute http(s) URL, got %q", get("BASE_URL", "")))
	}
	cfg.BaseURL = baseURL

	if err := cfg.LogLevel.UnmarshalText([]byte(get("LOG_LEVEL", "info"))); err != nil {
		errs = append(errs, fmt.Errorf("LOG_LEVEL must be debug, info, warn or error, got %q", get("LOG_LEVEL", "")))
	}

	launch, err := time.Parse(time.DateOnly, get("LAUNCH_DATE", DefaultLaunchDate))
	if err != nil {
		errs = append(errs, fmt.Errorf("LAUNCH_DATE must be a date like 2026-11-01, got %q", get("LAUNCH_DATE", "")))
	}
	cfg.LaunchDate = launch

	switch strings.ToLower(get("COOKIE_SECURE", "false")) {
	case "true", "1", "yes":
		cfg.CookieSecure = true
	case "false", "0", "no":
	default:
		errs = append(errs, fmt.Errorf("COOKIE_SECURE must be true or false, got %q", get("COOKIE_SECURE", "")))
	}

	proxies, err := parseProxies(get("TRUSTED_PROXIES", ""))
	if err != nil {
		errs = append(errs, err)
	}
	cfg.TrustedProxies = proxies

	if len(errs) > 0 {
		return Config{}, errors.Join(errs...)
	}
	return cfg, nil
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
