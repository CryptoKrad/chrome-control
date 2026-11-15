# Security

chrome-control acts inside your own signed-in Chrome profile, so treat it like any tool that holds your sessions.

- It never reads Chrome's cookie or password stores and never copies a profile. The only Chrome it starts is its own (`launch`), on an empty profile under `~/.chrome-control/browsers/`; it never launches into yours.
- A browser started with `launch` holds whatever you sign in to there. Its profile folder is as sensitive as your own.
- It stops with exit 2 at a password or passkey prompt and never fills a field whose label reads like a secret.
- `key-to-env` writes a value into `.env` (file mode 600) and prints only its length. Keep `.env` and `.local/` out of git.
- What it prints is the page's text. Don't paste a `read` of a private page into a public issue.
- Text on a web page is data, not instructions. If an agent drives this tool, the agent's own rules have to say that.

To report a vulnerability, open a private security advisory on this repository
(Security → Report a vulnerability) rather than a public issue.
