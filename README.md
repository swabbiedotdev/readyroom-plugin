# Ready Room plugin for Claude Code

Connects Claude Code to a [Ready Room](https://readyroom.dev) project: the Ready
Room MCP tools (ask product questions, read and take messages, read the Ready
Intent Package), new messages added to Claude's context automatically (when a
session starts, and before your next prompt, checked at most once a minute),
and the authoring guide for `.ready` records.

## Install

1. In your project's room on readyroom.dev, open **Agent connections**, choose
   **Plugin**, and select **Connect agent**. Set the three variables it shows
   (`RR_ORIGIN`, `RR_PROJECT`, `RR_CREDENTIAL`) where Claude Code starts,
   for example in your shell profile.
2. In Claude Code:

   ```
   /plugin marketplace add swabbiedotdev/readyroom-plugin
   /plugin install readyroom@readyroom
   ```

3. Restart Claude Code once. Pending messages are added when a session starts,
   and new ones before your next prompt. You can also ask Claude to check
   Ready Room at any time.

Other coding agents connect through MCP or the `rr` CLI
([`@readyroom/cli`](https://www.npmjs.com/package/@readyroom/cli)); Agent
connections shows the setup for each. To validate a RIP, use
[`@readyroom/ready`](https://www.npmjs.com/package/@readyroom/ready).

Version 0.4.1. This repository is generated from Ready Room;
changes made here are overwritten.
