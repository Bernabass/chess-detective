// A fake lichess.org for the web app's end-to-end tests (started by scripts/e2e-api.mjs). It
// follows the Lichess OAuth API (lichess-org/api, doc/specs/tags/oauth): an authorization page
// where the test types a username and clicks Authorize or Cancel, a token endpoint that checks
// the PKCE pair, redirect_uri and client_id, the account endpoint, and token revocation.
// GET /_fake/state tells the tests how many tokens are still alive.
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const challengeOf = (verifier) => createHash('sha256').update(verifier).digest('base64url');
const secret = (prefix) => prefix + randomBytes(16).toString('hex');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);

export function startFakeLichess(port) {
  const codes = new Map(); // code -> { challenge, redirectUri, clientId, username }
  const tokens = new Map(); // token -> username
  let revoked = 0;

  const json = (res, status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const redirect = (res, location) => {
    res.writeHead(302, { Location: location });
    res.end();
  };
  const readBody = (req) =>
    new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        resolve(data);
      });
    });

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${String(port)}`);
      const q = url.searchParams;
      const route = `${req.method ?? 'GET'} ${url.pathname}`;

      if (route === 'GET /oauth') {
        if (
          q.get('response_type') !== 'code' ||
          q.get('code_challenge_method') !== 'S256' ||
          !q.get('code_challenge') ||
          !q.get('client_id') ||
          !q.get('redirect_uri') ||
          q.has('scope')
        ) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('bad authorization request');
          return;
        }
        const hidden = [...q.entries()]
          .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
          .join('');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Fake Lichess</title></head>
<body><main><h1>Fake Lichess</h1>
<p>${escapeHtml(q.get('client_id'))} wants to access your Lichess account (public data only).</p>
<form method="get" action="/oauth/decide">${hidden}
<label for="username">Lichess username</label> <input id="username" name="username" value="e2e_player">
<button name="decision" value="authorize">Authorize</button>
<button name="decision" value="cancel">Cancel</button>
</form></main></body></html>`);
        return;
      }

      if (route === 'GET /oauth/decide') {
        const back = new URLSearchParams({ state: q.get('state') ?? '' });
        if (q.get('decision') === 'authorize') {
          const code = secret('liu_');
          codes.set(code, {
            challenge: q.get('code_challenge'),
            redirectUri: q.get('redirect_uri'),
            clientId: q.get('client_id'),
            username: q.get('username') ?? 'e2e_player',
          });
          back.set('code', code);
        } else {
          back.set('error', 'access_denied');
          back.set('error_description', 'user cancelled authorization');
        }
        redirect(res, `${q.get('redirect_uri') ?? ''}?${back.toString()}`);
        return;
      }

      if (route === 'POST /api/token') {
        if (req.headers['content-type'] !== 'application/x-www-form-urlencoded') {
          json(res, 400, { error: 'invalid_request' });
          return;
        }
        const form = new URLSearchParams(await readBody(req));
        const code = form.get('code') ?? '';
        const pending = codes.get(code);
        codes.delete(code);
        if (
          !pending ||
          form.get('grant_type') !== 'authorization_code' ||
          challengeOf(form.get('code_verifier') ?? '') !== pending.challenge ||
          form.get('redirect_uri') !== pending.redirectUri ||
          form.get('client_id') !== pending.clientId
        ) {
          json(res, 400, { error: 'invalid_grant', error_description: 'fake says no' });
          return;
        }
        const token = secret('lio_');
        tokens.set(token, pending.username);
        json(res, 200, { token_type: 'Bearer', access_token: token, expires_in: 31536000 });
        return;
      }

      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (route === 'GET /api/account') {
        const username = tokens.get(token);
        if (username === undefined) json(res, 401, { error: 'No such token' });
        else json(res, 200, { id: username.toLowerCase(), username, perfs: {} });
        return;
      }
      if (route === 'DELETE /api/token') {
        if (tokens.delete(token)) revoked += 1;
        res.writeHead(204);
        res.end();
        return;
      }
      if (route === 'GET /_fake/state') {
        json(res, 200, { live: tokens.size, revoked });
        return;
      }
      res.writeHead(404);
      res.end();
    })();
  });
  server.listen(port, '127.0.0.1');
  return server;
}
