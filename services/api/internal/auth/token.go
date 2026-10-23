package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"time"
)

// Session settings (SPEC §10.6).
const (
	CookieName = "rg_session"
	// SessionTTL is the sliding expiry: a session lives this long after it was last used.
	SessionTTL = 30 * 24 * time.Hour
	// TouchInterval: the sliding expiry is written at most this often per session.
	TouchInterval = time.Hour
	// GuestRetention: guests with no guesses are deleted after this long (DECISIONS 2026-10-23).
	GuestRetention = 30 * 24 * time.Hour
)

// NewToken returns a fresh session token (32 random bytes, base64url) and its hash, which is
// all the database stores.
func NewToken() (token string, hash []byte) {
	buf := make([]byte, 32)
	_, _ = rand.Read(buf) // crypto/rand.Read never fails
	token = base64.RawURLEncoding.EncodeToString(buf)
	return token, HashToken(token)
}

// HashToken is the sha256 of a token.
func HashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}
