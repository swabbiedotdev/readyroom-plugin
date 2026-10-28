// SessionStart hook: stdout becomes session context. Always exits 0.
import { sessionStartNotice } from './messages.mjs';

process.stdout.write(`${await sessionStartNotice({ env: process.env })}\n`);
