package config

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
)

// minCronSecret is the shortest CRON_SECRET accepted in production.
const minCronSecret = 32

// ProductionProblems lists settings that are obviously unsafe in production; serve refuses to
// start while there are any (ARCHITECTURE.md §10.2). Outside production mode it returns nothing.
func (c Config) ProductionProblems() []error {
	if !c.Production {
		return nil
	}
	var p []error
	add := func(format string, args ...any) { p = append(p, fmt.Errorf(format, args...)) }

	if !c.CookieSecure {
		add("COOKIE_SECURE must be true in production (the session cookie only over HTTPS)")
	}
	if c.BaseURL == nil || c.BaseURL.Scheme != "https" || isLocalHost(c.BaseURL.Hostname()) {
		add("BASE_URL must be the site's public https address in production, got %q", c.BaseURL)
	}
	if c.RateLimitScale != 1 {
		add("RATE_LIMIT_SCALE must be 1 in production, got %d", c.RateLimitScale)
	}
	if !c.LaunchDateSet {
		add("LAUNCH_DATE must be set in production (puzzle #1's date)")
	}
	for _, proxy := range c.TrustedProxies {
		if proxy.Bits() == 0 {
			add("TRUSTED_PROXIES must not trust every address (%s): anyone could forge their IP", proxy)
		}
	}
	if c.LichessBaseURL == nil || c.LichessBaseURL.String() != "https://lichess.org" {
		add("LICHESS_BASE_URL must be https://lichess.org in production, got %q", c.LichessBaseURL)
	}
	if c.CronSecret != "" && len(c.CronSecret) < minCronSecret {
		add("CRON_SECRET must be at least %d characters", minCronSecret)
	}

	if c.OnVercel {
		if c.CronSecret == "" {
			add("CRON_SECRET must be set on Vercel (it authorizes the daily cleanup)")
		}
		if c.ClientIPHeader == "" {
			add("CLIENT_IP_HEADER must be set on Vercel (X-Real-IP); otherwise every visitor shares one rate limit")
		}
		if err := checkHostedDatabase(c.DatabaseURL); err != nil {
			p = append(p, err)
		}
	}
	return p
}

// checkHostedDatabase rejects a database URL that can't be right for a hosted deployment: a
// local host, or TLS switched off.
func checkHostedDatabase(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return errors.New("DATABASE_URL must be a postgres:// URL")
	}
	if isLocalHost(u.Hostname()) {
		return fmt.Errorf("DATABASE_URL points at %s, which can't be the production database", u.Hostname())
	}
	if strings.EqualFold(u.Query().Get("sslmode"), "disable") {
		return errors.New("DATABASE_URL must not set sslmode=disable on a hosted deployment")
	}
	return nil
}

func isLocalHost(host string) bool {
	host = strings.ToLower(host)
	return host == "" || host == "localhost" || strings.HasSuffix(host, ".localhost") ||
		strings.HasPrefix(host, "127.") || host == "::1" || host == "0.0.0.0"
}
