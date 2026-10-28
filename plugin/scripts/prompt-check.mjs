// UserPromptSubmit hook: stdout is added to the prompt's context, so it prints
// only Ready Room messages that are new since they were last shown. Always
// exits 0 and never blocks the prompt.
import { promptNotice } from './messages.mjs';

const notice = await promptNotice({ env: process.env });
if (notice) process.stdout.write(`${notice}\n`);
