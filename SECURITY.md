# Security Policy

## Your tokens are yours — protect them

This app works with **your personal** DeepSeek credentials. Treat them like passwords:

- Never paste tokens, session data, or personal file paths into issues, PRs, screenshots, or videos.
- Never commit local config, session, or chat-history files — the repo's `.gitignore` already excludes them. Run `git status` before every commit.
- If a personal credential ever leaks (even partially), **rotate it immediately**: log out and back in at `chat.deepseek.com`, get a fresh token, remove local session files, and restart the app.

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities. Instead:

1. Open a [private security advisory](https://github.com/11nawid/deepseek-free/security/advisories/new), or
2. Open an issue titled `[Security]` with details redacted and ask for a contact.

We aim to acknowledge reports within 72 hours.

## Out of scope

- DeepSeek's own web endpoints changing or blocking automation (expected behavior for an unofficial client).
- Issues caused by a leaked personal credential (rotate it — see above).
