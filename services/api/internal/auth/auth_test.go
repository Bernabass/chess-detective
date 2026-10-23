package auth_test

import (
	"strings"
	"testing"

	"github.com/Bernabass/chess-detective/services/api/internal/auth"
)

func TestPasswordHashing(t *testing.T) {
	h, err := auth.HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$argon2id$v=19$m=19456,t=2,p=1$") {
		t.Errorf("hash %q doesn't record OWASP's minimum parameters", h)
	}
	if ok, err := auth.VerifyPassword("correct horse battery staple", h); err != nil || !ok {
		t.Errorf("right password: ok=%v err=%v", ok, err)
	}
	if ok, err := auth.VerifyPassword("wrong", h); err != nil || ok {
		t.Errorf("wrong password: ok=%v err=%v", ok, err)
	}
	other, err := auth.HashPassword("correct horse battery staple")
	if err != nil {
		t.Fatal(err)
	}
	if other == h {
		t.Error("two hashes of one password must differ (random salt)")
	}
	for _, bad := range []string{"", "$argon2i$v=19$m=1,t=1,p=1$AA$AA", "$argon2id$v=19$m=x$AA$AA", "plain"} {
		if _, err := auth.VerifyPassword("x", bad); err == nil {
			t.Errorf("malformed hash %q accepted", bad)
		}
	}
}

func TestTokens(t *testing.T) {
	tok, hash := auth.NewToken()
	if len(tok) != 43 || strings.ContainsAny(tok, "+/=") {
		t.Errorf("token %q isn't 32 bytes of base64url", tok)
	}
	if string(auth.HashToken(tok)) != string(hash) || len(hash) != 32 {
		t.Error("hash must be the sha256 of the token")
	}
	other, _ := auth.NewToken()
	if other == tok {
		t.Error("tokens must be random")
	}
}
