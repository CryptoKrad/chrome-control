# chrome-control

Drive Chrome on macOS from a script or an AI agent, behind the app you have in front, for few tokens. It reads a page as short lines, presses buttons and links by their exact label, fills and types into fields, and after each action prints only what changed. It works through macOS Accessibility: no browser extension, no debugging port, and it never copies your cookies.

It is an open alternative to [Claude in Chrome](https://code.claude.com/docs/en/chrome), Anthropic's browser extension, for browser steps that any agent or script should run as plain, repeatable commands. It is not affiliated with Anthropic, Google or Cua.

```sh
$ chrome-control read
page: Overview (window 1201)
combobox "Inspect any URL in example.com"
button "Search"
$ chrome-control fill "Inspect any URL in example.com" https://example.com/pricing
changed: 1 new lines, 1 gone
combobox "Inspect any URL in example.com" = "https://example.com/pricing"
$ chrome-control press "Search" button
$ chrome-control wait "URL is on Google" 60
```

## Two places it can work
| | Your own window | A browser of its own |
|---|---|---|
| What | A window of your signed-in Chrome, kept by its id (`use <id>`). | A second Chrome the tool starts in the background on an empty profile (`launch <name>`, then `--browser <name>`). |
| Signed in | Already, as you. | You sign in there yourself, once. Nothing is copied over. |
| Read, press, fill | In the background. | In the background. |
| Type and keys | Only when your Chrome has one window. | Yes. It starts with one window and keeps to it unless a page opens another. |
| Open a page | In the background with one window. With several it brings Chrome forward, and says so. | In the background. |
| A window under another Chrome window | Chrome pauses its page, and the tool refuses to act (exit 3) unless Chrome runs with one flag. See `doctor`. | Does not happen: one window, started with the flag. |
| Several agents | One window each, or one tab each in a shared window (`tab <id>`). | One browser each. |

Every line of that table was measured. The readings are in [docs/research/background-2026-11-14.md](docs/research/background-2026-11-14.md).

## chrome-control or Claude in Chrome?

| | chrome-control | Claude in Chrome |
|---|---|---|
| What it is | A Node script. Any agent or script calls it as a shell command. | A Chrome extension, used from Chrome's side panel, Claude Code (`claude --chrome`) and Claude Cowork. |
| Account | None. MIT licensed. | A paid Claude plan: Pro, Max, Ultra, Team or Enterprise. |
| Browser | Google Chrome on macOS. | Chrome and Edge. From Claude Code it also connects to Brave, Arc, Vivaldi and Opera. Not WSL. |
| Window | A window you already have open, or a browser the tool starts behind your work. | New tabs that Claude opens, collected in a tab group. |
| Your screen | It works behind the app in front. One case brings Chrome forward: `open` in your own Chrome with several windows, when the new tab page's search box is not there. | Actions "run in a visible Chrome window in real time". |
| What it sees | The page's accessibility tree, as short text lines. | The page, its DOM, the console, screenshots and GIF recordings. |
| Who decides each step | You or your agent, by exact label. A label it can't find once is refused, never guessed. | The model, on the page as it sees it. |
| Guard rails | It stops at password and passkey prompts, won't fill secret fields and won't act in a page Chrome has paused. | Per-site permissions. Some actions, such as purchases and account creation, are refused in every mode. |

The Claude in Chrome column quotes Anthropic's own pages, read on 2026-11-14. The quotes are in [docs/research](docs/research/claude-in-chrome-2026-11-14.md).

**Choose chrome-control when:**
- a step repeats and you want it to run the same way each time, cheaply;
- you don't want an extension, a debugging port or a copied profile;
- you want to keep working in your editor while the browser step runs;
- your agent isn't Claude, or you run several agents at once.

**Choose Claude in Chrome when:**
- you need the DOM, JavaScript, the console, file uploads, screenshots or recordings;
- you're on Windows or Linux, or you use a browser other than Chrome;
- you want Claude to work out the steps on a page nobody has scripted.

## Cheap to read
- **A page prints as short lines.** Roles lose their `AX`, and action lists, repeated labels, unnamed groups and the column copy of every table are left out. One Search Console page measured 38,321 characters as the raw tree and 2,261 as `read` prints it.
- **An action prints what it changed**, not the page again. If the address changed, it prints the first 25 lines of the new page.
- **`find "<text>"`** prints only the lines that hold the text. **`wait "<text>"`** polls for you, so the agent does not loop.
- A line is cut at 160 characters with `…`. `press` accepts a label that ends in `…` as the label's opening.
- `read --raw` still prints the full tree, for a script that parses it.

## How it works
1. **It finds the Chrome to work in.** Your own is the Chrome process started without `--user-data-dir`; Playwright, Puppeteer and agent browsers start Chrome with one. A browser of its own is the process on its folder under `~/.chrome-control/browsers/`. It never addresses Chrome by name or bundle id, which reached the wrong Chrome when measured.
2. **It finds the window.** In your own Chrome it takes windows of one profile, by the accessibility title `… - Google Chrome - <name> (<profile>)`. You keep one with `use <id>`.
3. **It reads** the window's accessibility tree through [cua-driver](https://github.com/trycua/cua) and prints it as short lines.
4. **It acts on one element.** `press`, `fill` and `type` find the single element with that exact label. A role, or the text of a table row, narrows the search. cua-driver performs the action on that element without raising the window.
5. **It checks the page is live.** Chrome pauses a page whose window sits fully under another window of the same Chrome: the tree stops and animations wait, while presses still land unseen. The tool works that out from the windows' frames and order and refuses to act in such a window. Once paused, the page stays paused while another app's window lies over it, even after the cover or the window moves (measured 2026-11-17). So the cures are `open`, the start flag that `doctor` names, or a browser of the tool's own (`launch`).

## Rules it keeps
- **No app is put back in front**, and none is brought forward, with one exception: `open` in your own Chrome with several windows, when the new tab page's search box is not there (its last resort, an Apple Event). If the front app changes during a command, the tool says so and leaves it.
- **Passwords and passkeys are yours.** A page that asks for one ends the command with exit 2. A field whose label reads like a secret is never filled or typed into.
- **One match or nothing.** If a label is on the page twice, or a title is on two tabs, the command is refused, not guessed.
- **No acting in a paused page or on an old tree.** Both end `press`, `fill`, `type`, `key`, `click`, `wait` and `key-to-env` with exit 3. `read` still prints, with a warning.
- **A refused key is never sent another way.** When cua-driver refuses a background key, the tool says why. It does not fall back to a foreground key.
- **One window or one tab, one session.** A second session is refused a window or a tab another one keeps.
- **Keys stay unprinted.** `key-to-env` writes the one text on the page that matches your pattern into `.env`, and prints only its length.
- **Nothing is copied from your profile.** A copied profile shows a site the same session from two browsers. When that was tried once, outside this tool, the sites ended the session in the real browser. So the tool works in the real window, or in an empty profile you sign in to.

## Install
You need macOS 14 or later, Google Chrome and Node 22 or later.

1. Install cua-driver and grant its permissions. The command below runs Cua's installer script; read it first if you like.
   ```sh
   /bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"
   cua-driver permissions grant      # switch on Accessibility and Screen & System Audio Recording
   ```
2. Get the tool and check it:
   ```sh
   git clone https://github.com/CryptoKrad/chrome-control
   cd chrome-control && node --test && node chrome-control.mjs doctor
   ```
3. In your own Chrome with several windows, `open` types the address into the new tab page's own search box and presses its suggestion, in the background. Only when that box is missing does it use an Apple Event; the first one makes macOS ask whether your terminal may control Google Chrome. Allow it.

`chrome-control` in this page stands for `node /path/to/chrome-control/chrome-control.mjs`. Run `npm link` in the folder to get the short name.

## Set up
**Your own Chrome:**
- **Pick a profile.** With one profile there is nothing to set. Otherwise set `OWNER_CHROME_PROFILE` to the profile's folder name, in your environment or in a `.env` file in the folder you run the tool from (`OWNER_CHROME_PROFILE="Profile 1"`). `chrome-control profiles` lists every folder with the account signed in to it; choose by the account that holds the sign-in you need.
- **Keep one window.** `windows` lists the profile's windows, and `use <id>` keeps one. The choice is saved in `.local/chrome-control.json`. Keep `.env` and `.local/` out of git.
- **Keep covered windows live (optional, once).** Quit Chrome, then start it with `open -a "Google Chrome" --args --disable-backgrounding-occluded-windows`. `doctor` shows whether the flag is on.

**A browser of its own:**
```sh
chrome-control launch work https://example.com     # starts behind your front app
chrome-control read --browser work                 # or set CHROME_CONTROL_BROWSER=work
```
Its profile lives in `~/.chrome-control/browsers/work`. Sign in to what the agent needs there yourself. Quit it like any Chrome.

## Commands
| Command | What it does |
|---|---|
| `windows` | List the windows: id, title, and which session keeps each. |
| `use <id> [--take]` | Keep that window for this session. `release` gives it back. |
| `tab <id> [url]` | Open a new tab in that window and keep it for this session. Every later command works in that tab, and other sessions can keep their own tabs in the same window. `release` lets go and leaves the tab open; `close-tab` with no title closes it. |
| `read [lines] [--ui] [--raw]` | Print the page as short lines. The default is 60. `--ui` prints the browser's own toolbar, tabs and extension buttons. `--raw` prints the full tree. |
| `find "<text>"` | Print the lines that hold the text. |
| `wait "<text>" [seconds]` | Poll until the page holds the text. The default is 20 seconds, the most 300. |
| `press "<label>" [role] ["<row text>"]` | Press the one element with that label. A role (`button`, `link`) and a table row's text narrow it. |
| `fill "<label>" <text> [role]` | Set a field's value. The page gets `input` and `change` events. |
| `type "<label>" <text> [role]` | Type with real key events. |
| `key <name> ["<label>"]` | Press `return`, `tab`, `escape`, an arrow, or a chord such as `cmd+a`. |
| `click <x> <y>` | Click a pixel of the window's capture, for something with no label. |
| `open <url>` | Open the address in a new tab of the kept window, in the background. With a kept tab, load it in that tab. |
| `close-tab ["<title>"]` | Close the one tab with that title. With a kept tab, take no title and close that tab. |
| `key-to-env <NAME> '<regex>'` | Write the one text on the page that matches into `.env` as `NAME`, without printing it. |
| `launch <name> [url]` | Start a browser of the tool's own in the background. |
| `profiles` | List Chrome's profile folders, their names and the account signed in to each. Pick `OWNER_CHROME_PROFILE` from it by the account, not by the name. |
| `doctor` | Say what works right now: permissions, the flag, keys, and whether the kept window is live. |
| `stop` | Stop cua-driver. |

Add `--session <name>` (or `CHROME_CONTROL_SESSION`) and `--browser <name>` (or `CHROME_CONTROL_BROWSER`) to any command.

**Exit codes:**
- 0: done.
- 1: refused. Nothing or more than one thing matched, no window is kept, another session keeps it, or cua-driver refused a key.
- 2: your step. The page asks for a password or passkey, or the field is a secret.
- 3: the page is paused or its tree is old.
- 4: `wait` timed out.

## Use it from an AI agent
Any agent that can run a shell command can use the tool. You can paste this into `CLAUDE.md` or `AGENTS.md`:

```text
Browser steps go through chrome-control (/path/to/chrome-control/chrome-control.mjs).
- `read` first, then act only on labels you saw: `press "<label>" button`, `fill "<label>" <text>`.
- An action prints what changed. Use `find "<text>"` and `wait "<text>" 30`; do not re-read the page in a loop.
- Exit 2 is a password or passkey: stop and ask me. Exit 3: run `doctor` and tell me what it says.
- Never type a secret into a page. `key-to-env` moves a key into .env without printing it.
```

In Claude Code you can allow reads without a prompt and keep a prompt for actions. Add this to `.claude/settings.json`, using absolute paths:

```json
{ "permissions": { "allow": ["Bash(node /path/to/chrome-control/chrome-control.mjs read *)", "Bash(node /path/to/chrome-control/chrome-control.mjs find *)", "Bash(node /path/to/chrome-control/chrome-control.mjs doctor)"] } }
```

**Several agents at once:**
- Give each agent its own session: `CHROME_CONTROL_SESSION=agent-2`. A wrapper script must set it too; with no name, a command runs as the session `default`.
- To share one window, each session runs `tab <window id> [url]`. Chrome's accessibility tree holds only a window's active tab, so one command at a time shows its session's tab, checks that the tree holds that tab's page, acts, and puts the previous tab back. Commands from different sessions wait for each other (at most 60 s), and a `wait` lets others run between its polls.
- A window kept whole with `use` and a window with tabs of other sessions exclude each other, because `use` works in whatever tab is active.
- To keep a whole window instead, use `use <id>`: it refuses a window another session keeps.
- Or give each agent its own browser: `launch agent-2`, then `CHROME_CONTROL_BROWSER=agent-2`. This is the route where typing and background page opens work, since each browser has one window.
- Acting commands in one Chrome run one at a time. A command waits up to 30 seconds for the one before it.

## Limits
- **macOS and Google Chrome only.** It needs cua-driver with its two permissions.
- **Keys need a Chrome with one window.** With several, cua-driver refuses a background key, because it could land in another window. `fill` and the page's own buttons cover most forms. A browser of the tool's own starts with one window, so keys work there until a page opens a second one.
- **A window under another Chrome window is paused by Chrome**, unless Chrome was started with `--disable-backgrounding-occluded-windows`. A window behind another app stayed live for the minute it was watched.
- **Only labelled elements.** Something with no label, or a label that repeats with no role or row to tell the copies apart, cannot be pressed by label. Use `click x y`.
- **Extensions: buttons only.** `read --ui` lists a pinned extension's toolbar button and `press` presses it. What opens next, a popup or a bubble, did not show in the window's tree when measured, so the tool cannot work inside it.
- **It never opens a window in your own Chrome.** Every way measured brought Chrome to the front. Open the window yourself, once, or use `launch`.
- **No page internals.** It has no access to the DOM, JavaScript, the console, the network or downloads.
- **Not measured:** a minimized window, a window on another Space, and a second display. The tool warns about the first two.

## Test
```sh
node --test            # the rules, without Chrome or cua-driver; CI runs this on every push
python3 lab/proofs.py  # removes each guard in turn; the tests must fail every time
node lab/e2e.mjs       # every command end to end, in a throwaway background browser (macOS, Chrome, cua-driver)
```

## License
MIT. See [LICENSE](LICENSE). "Chrome" is Google's trademark and "Claude" is Anthropic's. They are named here only to say what this tool works with and what it compares with.

Step-by-step recipes for jobs this tool has done (dropdowns, buttons with no label, a dashboard's add-a-domain flow) are in [docs/recipes.md](docs/recipes.md).
