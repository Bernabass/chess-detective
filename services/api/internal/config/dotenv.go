package config

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var envKey = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// ParseDotEnv reads KEY=VALUE lines. Blank lines and lines starting with # are
// skipped, an optional "export " prefix is allowed, values may be wrapped in
// single or double quotes, and an unquoted value ends at " #" (an inline comment).
func ParseDotEnv(r io.Reader) (map[string]string, error) {
	values := make(map[string]string)
	scanner := bufio.NewScanner(r)
	for lineNo := 1; scanner.Scan(); lineNo++ {
		line := strings.TrimSpace(scanner.Text())
		if lineNo == 1 {
			line = strings.TrimPrefix(line, "\xef\xbb\xbf") // files saved by Notepad may start with a UTF-8 BOM
		}
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, found := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !found || !envKey.MatchString(key) {
			return nil, fmt.Errorf("line %d: expected KEY=VALUE", lineNo)
		}
		values[key] = unquote(strings.TrimSpace(value))
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading .env: %w", err)
	}
	return values, nil
}

func unquote(value string) string {
	if len(value) >= 2 {
		first, last := value[0], value[len(value)-1]
		if (first == '"' || first == '\'') && first == last {
			return value[1 : len(value)-1]
		}
	}
	if i := strings.Index(value, " #"); i >= 0 {
		value = strings.TrimSpace(value[:i])
	}
	return value
}

// FindDotEnv looks for a .env file in dir and its parents, stopping at the
// repository root (a directory containing .git). It returns "" if there is none.
func FindDotEnv(dir string) (string, error) {
	dir, err := filepath.Abs(dir)
	if err != nil {
		return "", fmt.Errorf("resolving %q: %w", dir, err)
	}
	for {
		candidate := filepath.Join(dir, ".env")
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		} else if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return "", fmt.Errorf("checking %s: %w", candidate, err)
		}
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			return "", nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", nil
		}
		dir = parent
	}
}

// Lookup returns the value of an environment setting and whether it is set.
type Lookup func(key string) (string, bool)

// Environ returns a Lookup that reads real environment variables first and
// falls back to the nearest .env file above dir. It never modifies the
// process environment.
func Environ(dir string) (Lookup, error) {
	path, err := FindDotEnv(dir)
	if err != nil {
		return nil, err
	}
	fileValues := map[string]string{}
	if path != "" {
		f, err := os.Open(path) //nolint:gosec // path is a .env file found by FindDotEnv
		if err != nil {
			return nil, fmt.Errorf("opening %s: %w", path, err)
		}
		defer func() { _ = f.Close() }()
		if fileValues, err = ParseDotEnv(f); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
	}
	return func(key string) (string, bool) {
		if v, ok := os.LookupEnv(key); ok {
			return v, true
		}
		v, ok := fileValues[key]
		return v, ok
	}, nil
}
