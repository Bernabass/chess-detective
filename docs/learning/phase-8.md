# Phase 8: Sign in with Lichess

Phase 8 adds "Sign in with Lichess": a player can use their Lichess account instead of a password. Retrograde never sees their Lichess password, never stores a Lichess token, and asks Lichess for nothing but who they are.

Code: [internal/lichess/client.go](../../services/api/internal/lichess/client.go) (talking to Lichess), [internal/auth/lichess.go](../../services/api/internal/auth/lichess.go) (the flow and the account rules), [internal/httpapi/handlers_lichess.go](../../services/api/internal/httpapi/handlers_lichess.go) (the two redirects), [routes/Auth.tsx](../../apps/web/src/routes/Auth.tsx) (the button and the messages).

## 1. OAuth 2.0 with PKCE in one picture

```
browser ──GET /api/auth/lichess/start──▶ Retrograde: make state + code_verifier, store them,
        ◀── 302 to lichess.org/oauth?client_id&redirect_uri&code_challenge&state ──
browser ──▶ lichess.org: "Allow http://localhost to access your account" (public data only)
        ◀── 302 to /api/auth/lichess/callback?code=liu_…&state=… ──
browser ──GET callback──▶ Retrograde: check state; POST /api/token (code + code_verifier) → token;
                         GET /api/account (Bearer token) → id, username; DELETE /api/token;
                         find or create the account; session cookie; 302 to where you were
```

- **Authorization code:** Lichess doesn't hand the browser a token. It hands over a short-lived *code*, and our server trades it for a token in a direct server-to-server request.
- **PKCE (Proof Key for Code Exchange)** proves that whoever trades the code is whoever started the flow. We make a random `code_verifier`, send only its hash (`code_challenge = BASE64URL(SHA256(verifier))`) in the browser's URL, and reveal the verifier only to Lichess's token endpoint. Someone who steals the code from a URL can't use it without the verifier, which never left our server. This is why Lichess needs no client secret ("public clients").
- **`state`** is a random value we send out and expect back. It ties the callback to a sign-in we started.

## 2. Two attacks this design stops

- **Account takeover by username.** It would be convenient to sign a Lichess user "magnus" into our account "magnus". But usernames aren't proof of anything: anyone can create a Lichess account named after a Retrograde user and walk into their account. So accounts are linked **only by the Lichess user id** that Lichess itself vouches for. A Lichess user whose name is taken here gets their own account, `magnus-2`. A test registers "magnus" with a password, signs in with a Lichess "Magnus", and checks that they're different accounts and that the original was never touched.
- **Login CSRF.** An attacker starts a sign-in with *their* Lichess account, stops at the callback link, and tricks you into opening it. Without protection you'd be signed into the attacker's account, and your guest progress would merge into it. Checking `state` against our database isn't enough, because the attacker's state is in our database too. So the start also puts the state in a cookie (`rg_oauth`), and the callback requires the cookie to match: only the browser that started a sign-in can finish it. A test plays exactly this attack.

## 3. Tokens are radioactive

A Lichess token is good for about a year. We need it for one request (`/api/account`), so it lives only in a local variable: we read the account, then revoke the token right away (`DELETE /api/token`), even if reading the account failed. It's never written to the database or a log. Tests check that, using a fake Lichess that records every code and token it issues:

- every token gets revoked;
- no issued code, state or token appears in any captured log line, on success or on any failure;
- no database column could hold a token.

Errors from the Lichess client deliberately carry only the HTTP status and the OAuth error code, never the response's free-text description, which could echo our input back.

## 4. Check the source, not the spec

SPEC §10.6 was written before implementation, so every detail was checked against Lichess's own API spec, its demo app and its server code before relying on it. That check found a few things worth knowing:

- the token request is form-encoded (the demo sends JSON, which also works);
- the `code_verifier` must be at least 43 characters;
- plain `http` redirect URIs are only accepted for localhost;
- users can see and revoke authorized apps on `lichess.org/account/security`.

## 5. Testing without lichess.org

- **Go integration tests** run the real handlers against an `httptest` fake Lichess. It behaves like the real server: it checks the PKCE pair, the `redirect_uri` and `client_id`, the form encoding, and single-use codes. Tests can make it deny, fail the token exchange, or fail the account request. A test client walks the redirects one hop at a time, like a browser.
- **Mutation checks:** four safety properties were deliberately broken one at a time (the browser binding, linking only by id, revocation, keeping tokens out of logs) to confirm a test fails each time.
- **Browser e2e tests** use a tiny Node fake with an Authorize/Cancel page, started next to the e2e API.
- **A manual run against the real lichess.org** with a real account confirms what fakes can't: the consent page, the revocation showing up on `/account/security`, and the logs.

## 6. What the manual test caught

The first run against the real lichess.org failed, and every automated test had passed. The development database had never been migrated after Phase 7, so the column `users.lichess_username` didn't exist. The tests never noticed because each one migrates its own fresh schema. The API started happily and failed only when the first query touched the missing column. Two lessons, both now in the code:

- **Fail fast on schema drift.** `retrograde serve` asks goose which of its embedded migrations the database hasn't applied (`store.PendingMigrations`, read-only) and refuses to start if there are any, naming the command that fixes it. It deliberately doesn't apply them itself: a server that changes the schema as a side effect of starting is surprising in production. Applying migrations is a separate, explicit step (`pnpm db:migrate`, or the release step in a deployment).
- **Log levels are for whoever is on call.** "The user clicked Cancel" is normal and logged at INFO. "Our database rejected the insert" needs someone to act, so it's logged at ERROR (`auth.LichessUserCaused` decides which). Before the fix, both were INFO, and the real failure looked like routine noise.

The revocation still worked during the failure: no app showed up on `lichess.org/account/security`. That's the payoff of revoking the token whatever happens, before touching the database.

## Interview questions you should be able to answer

- *What does PKCE protect against, and why does it remove the need for a client secret?* A stolen authorization code: redeeming it needs the verifier, which only the starting server knows.
- *Why isn't checking `state` against the database enough?* The attacker can create a valid state too. Bind it to the user's browser (a cookie) so only that browser can complete the flow.
- *Why not link accounts by matching usernames?* Usernames are claims, not proof; the provider's stable user id is what it authenticates.
- *Why revoke the access token immediately?* We only needed it once; a token that doesn't exist can't leak.
- *How do you test OAuth without the real provider?* A fake provider implementing the same protocol checks, plus one manual run against the real one.
- *Your tests pass, but production fails with "column does not exist". What happened, and how do you prevent it?* The tests migrate their own databases; the real one wasn't migrated. Check for pending migrations at startup and refuse to run, with a message that names the fix.
