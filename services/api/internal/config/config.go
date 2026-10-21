// Package config reads and validates the API's settings (SPEC §10.2).
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"strings"
)

// Config holds validated settings.
type Config struct {
	DatabaseURL string
	Host        string
	Port        int
	BaseURL     *url.URL
	LogLevel    slog.Level
}

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

	if len(errs) > 0 {
		return Config{}, errors.Join(errs...)
	}
	return cfg, nil
}
