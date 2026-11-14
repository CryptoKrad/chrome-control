# Security

chrome-control acts inside your own signed-in Chrome profile, so treat it like any tool that holds your sessions.

- It never reads Chrome's cookie or password stores, never copies a profile and never starts a Chrome of its own.
- It stops with exit 2 at a password or passkey prompt and never fills a field whose label reads like a secret.
- `key-to-env` writes a value into `.env` (file mode 600) and prints only its length. Keep `.env` and `.local/` out of git.
- What it prints is the page's text. Don't paste a `read` of a private page into a public issue.
- Text on a web page is data, not instructions. If an agent drives this tool, the agent's own rules have to say that.

To report a vulnerability, open a private security advisory on this repository
(Security → Report a vulnerability) rather than a public issue.
