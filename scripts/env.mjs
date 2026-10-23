// Shared helpers for scripts that read the project's .env (the Go API reads it the same way:
// real environment variables first, then KEY=VALUE lines in .env).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const envPath = fileURLToPath(new URL('../.env', import.meta.url));

const BOM = 0xfeff;
const NEWLINE = String.fromCharCode(10);

/**
 * The KEY=VALUE pairs in .env, or null without a .env. Parsed like the Go API's
 * internal/config/dotenv.go: a UTF-8 BOM, blank lines and # comments are skipped, an
 * "export " prefix is allowed, a quoted value ends at its closing quote, and an unquoted
 * value ends at " #" (an inline comment).
 */
export function readDotEnv() {
  if (!existsSync(envPath)) return null;
  let text = readFileSync(envPath, 'utf8');
  if (text.charCodeAt(0) === BOM) text = text.slice(1);
  const values = new Map();
  for (const raw of text.split(NEWLINE)) {
    let line = raw.trim(); // also drops the CR of CRLF files
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice('export '.length);
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    values.set(line.slice(0, eq).trim(), unquote(line.slice(eq + 1).trim()));
  }
  return values;
}

function unquote(value) {
  const quote = value[0];
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    if (end > 0) return value.slice(1, end);
  }
  const comment = value.indexOf(' #');
  return comment >= 0 ? value.slice(0, comment).trim() : value;
}

/** A setting from the environment, then .env; undefined when neither has a non-empty value. */
export function setting(dotEnv, key) {
  const value = process.env[key]?.trim() || dotEnv?.get(key)?.trim();
  return value === '' ? undefined : value;
}
