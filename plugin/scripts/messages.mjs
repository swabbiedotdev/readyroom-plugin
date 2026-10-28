import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The prompt check reads RR at most this often. */
export const PROMPT_CHECK_INTERVAL_MS = 60_000;

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
  const read = await readMessages(settings, request);
  if (read.error) return read.error;
  // Shown now, so the prompt check does not repeat them this session.
  saveState(env, settings, {
    checkedAt: Date.now(),
    shown: read.messages.map((message) => message.message_id),
  });
  if (read.messages.length === 0) return 'Ready Room: no pending messages.';
  return redact(
    formatMessages(
      `Ready Room: ${read.messages.length} pending message${read.messages.length === 1 ? '' : 's'} for this project, oldest first.`,
      read.messages,
    ),
    settings.credential,
  );
}

/**
 * The UserPromptSubmit check: messages that arrived since they were last
 * shown, read at most once a minute. Silent (empty) when there is nothing new,
 * when it is not configured, or when RR cannot be read, so a quiet project
 * adds nothing to the conversation.
 * @param {{ env: Record<string, string | undefined>, fetch?: typeof fetch, now?: number }} io
 * @returns {Promise<string>}
 */
export async function promptNotice({
  env,
  fetch: request = fetch,
  now = Date.now(),
}) {
  let settings;
  try {
    settings = loadSettings(env);
  } catch {
    return '';
  }
  if (!settings || !secureOrigin(settings.origin)) return '';
  const state = loadState(env, settings);
  if (now - state.checkedAt < PROMPT_CHECK_INTERVAL_MS) return '';
  const read = await readMessages(settings, request);
  if (read.error) {
    saveState(env, settings, { ...state, checkedAt: now });
    return '';
  }
  const shown = new Set(state.shown);
  const fresh = read.messages.filter(
    (message) => !shown.has(message.message_id),
  );
  // Only still-pending ids are kept, so the file stays small.
  saveState(env, settings, {
    checkedAt: now,
    shown: read.messages.map((message) => message.message_id),
  });
  if (fresh.length === 0) return '';
  return redact(
    formatMessages(
      `Ready Room: ${fresh.length} new message${fresh.length === 1 ? '' : 's'} for this project since they were last checked.`,
      fresh,
    ),
    settings.credential,
  );
}

function redact(/** @type {string} */ text, /** @type {string} */ credential) {
  return text.replaceAll(credential, '[redacted]');
}

/**
 * Where the prompt check remembers when it last read RR and which messages
 * were shown, per origin and project.
 * @param {Record<string, string | undefined>} env
 * @param {{ origin: string, project: string }} settings
 */
function stateFile(env, settings) {
  const key = createHash('sha256')
    .update(`${settings.origin}\n${settings.project}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(
    env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'),
    'readyroom',
    `messages-${key}.json`,
  );
}

/** @returns {{ checkedAt: number, shown: string[] }} */
function loadState(
  /** @type {Record<string, string | undefined>} */ env,
  /** @type {{ origin: string, project: string }} */ settings,
) {
  try {
    const data = JSON.parse(fs.readFileSync(stateFile(env, settings), 'utf8'));
    return {
      checkedAt: Number(data.checkedAt) || 0,
      shown: Array.isArray(data.shown) ? data.shown.map(String) : [],
    };
  } catch {
    return { checkedAt: 0, shown: [] };
  }
}

/** A failed write only means the next check may repeat or come early. */
function saveState(
  /** @type {Record<string, string | undefined>} */ env,
  /** @type {{ origin: string, project: string }} */ settings,
  /** @type {{ checkedAt: number, shown: string[] }} */ state,
) {
  try {
    const file = stateFile(env, settings);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {
    // Ignored on purpose.
  }
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
 * @returns {Promise<{ error?: string, messages: any[] }>}
 */
async function readMessages(settings, request) {
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
      return {
        error:
          'Ready Room: the credential is missing, expired, or revoked, so RR messages were not checked. Connect again from the Agents panel and run `rr login`.',
        messages: [],
      };
    if (response.status === 403)
      return {
        error:
          'Ready Room: access refused, so RR messages were not checked. The connection may belong to another project, or the project may be deleted.',
        messages: [],
      };
    if (!response.ok) throw new Error();
    /** @type {any} */
    const body = await response.json();
    if (!Array.isArray(body?.messages)) throw new Error();
    return { messages: body.messages };
  } catch {
    return {
      error:
        'Ready Room: RR is unavailable, so messages were not checked. Continue from the repository RIP.',
      messages: [],
    };
  }
}

/** The messages, with how to take them, under a heading line. */
function formatMessages(
  /** @type {string} */ heading,
  /** @type {any[]} */ messages,
) {
  return [
    heading,
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
