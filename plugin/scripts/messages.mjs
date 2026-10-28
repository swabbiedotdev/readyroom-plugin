import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Same sources and precedence as the rr CLI: RR_ORIGIN, RR_PROJECT, and
 * RR_CREDENTIAL override $XDG_CONFIG_HOME/readyroom/config.json per field.
 * @param {Record<string, string | undefined>} env
 */
function loadSettings(env) {
  const file = path.join(
    env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'readyroom',
    'config.json',
  );
  /** @type {Record<string, unknown>} */
  let stored = {};
  if (fs.existsSync(file)) stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  /** @param {string} name @param {string} key */
  const pick = (name, key) =>
    env[name] || (typeof stored[key] === 'string' ? stored[key] : '');
  const origin = pick('RR_ORIGIN', 'origin');
  const project = pick('RR_PROJECT', 'project');
  const credential = pick('RR_CREDENTIAL', 'credential');
  return origin && project && credential
    ? { origin, project, credential }
    : null;
}

/**
 * The SessionStart notice: pending RR messages, or one line explaining why
 * none were read. Never throws and never includes the credential.
 * @param {{ env: Record<string, string | undefined>, fetch?: typeof fetch }} io
 * @returns {Promise<string>}
 */
export async function sessionStartNotice({ env, fetch: request = fetch }) {
  let settings;
  try {
    settings = loadSettings(env);
  } catch {
    return 'Ready Room: the stored rr config could not be read, so RR messages were not checked.';
  }
  if (!settings)
    return 'Ready Room: not configured, so RR messages were not checked. Set RR_ORIGIN, RR_PROJECT, and RR_CREDENTIAL, or run `rr login`.';
  if (!secureOrigin(settings.origin))
    return 'Ready Room: RR_ORIGIN must use HTTPS (HTTP only on localhost), so RR messages were not checked.';
  const { credential } = settings;
  return (await readNotice(settings, request)).replaceAll(
    credential,
    '[redacted]',
  );
}

/** HTTPS, or HTTP only on loopback hosts used for local development. */
function secureOrigin(/** @type {string} */ value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

/**
 * @param {{ origin: string, project: string, credential: string }} settings
 * @param {typeof fetch} request
 * @returns {Promise<string>}
 */
async function readNotice(settings, request) {
  /** @type {any} */
  let body;
  try {
    const url = new URL(
      `/api/agent/v1/projects/${encodeURIComponent(settings.project)}/read_messages`,
      settings.origin,
    );
    const response = await request(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${settings.credential}`,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401)
      return 'Ready Room: the credential is missing, expired, or revoked, so RR messages were not checked. Connect again from the Agents panel and run `rr login`.';
    if (response.status === 403)
      return 'Ready Room: access refused, so RR messages were not checked. The connection may belong to another project, or the project may be deleted.';
    if (!response.ok) throw new Error();
    body = await response.json();
    if (!Array.isArray(body?.messages)) throw new Error();
  } catch {
    return 'Ready Room: RR is unavailable, so messages were not checked. Continue from the repository RIP.';
  }
  /** @type {any[]} */
  const messages = body.messages;
  if (messages.length === 0) return 'Ready Room: no pending messages.';
  return [
    `Ready Room: ${messages.length} pending message${messages.length === 1 ? '' : 's'} for this project, oldest first.`,
    'Take a message with the acknowledge_message tool (or `rr ack <message_id>`) before acting on it; if it was already taken, leave it.',
    'For a rip_change, read the revision with read_rip: page 0 lists its files and their pages, then read the pages you need and apply the change to product/ in the RIP format.',
    '',
    ...messages.map((message) => {
      const details = [
        message.kind,
        message.revision_id && `revision ${message.revision_id}`,
        message.question_id && `question ${message.question_id}`,
        message.created_at,
      ].filter(Boolean);
      return `- ${message.message_id} (${details.join(', ')})\n${String(message.body).replace(/^/gm, '  ')}`;
    }),
  ].join('\n');
}
