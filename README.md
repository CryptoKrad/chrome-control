# chrome-control

Drive your own signed-in Chrome window on macOS from a script or an AI agent. It reads the page as text, presses buttons and links by their exact label, fills fields and closes tabs. It does this through macOS Accessibility, so you can keep working in another app. You don't need a browser extension or a debugging port, and it never copies your cookies.

It is an open alternative to [Claude in Chrome](https://code.claude.com/docs/en/chrome), Anthropic's browser extension. It suits browser steps that a script or any agent should run as plain, repeatable commands. It is not affiliated with Anthropic, Google or Cua.

```sh
$ node chrome-control.mjs read 6
- [0] AXWindow "Overview - Google Chrome - Sam (Work)" [actions=[raise]]
  - [24] AXWebArea "Overview" [actions=[showmenu,scrolltovisible]]
    - [27] AXComboBox "Inspect any URL in example.com" (Inspect any URL in example.com) [actions=[press,showmenu]]
    - [28] AXButton "Search" (Search) [actions=[press,showmenu,scrolltovisible]]
$ node chrome-control.mjs fill "Inspect any URL in example.com" https://example.com/pricing
$ node chrome-control.mjs press "Search" AXButton
```

## chrome-control or Claude in Chrome?

| | chrome-control | Claude in Chrome |
|---|---|---|
| What it is | A Node script. Any agent or script calls it as a shell command. | A Chrome extension, used from Chrome's side panel, Claude Code (`claude --chrome`) and Claude Cowork. |
| Account | None. MIT licensed. | A paid Claude plan: Pro, Max, Ultra, Team or Enterprise. |
| Browser | Your own Google Chrome on macOS. | Chrome and Edge. From Claude Code it also connects to Brave, Arc, Vivaldi and Opera. Not WSL. |
| Window | A window you already have open, kept by its id. | New tabs that Claude opens, collected in a tab group. |
| Your screen | Reads, presses and fills work behind the app in front. Only `open` brings Chrome forward. | Actions "run in a visible Chrome window in real time". |
| What it sees | The page's accessibility tree, as text. | The page, its DOM, the console, screenshots and GIF recordings. |
| Who decides each step | You or your agent, by exact label. A label it can't find once is refused, never guessed. | The model, on the page as it sees it. |
| Guard rails | It stops at password and passkey prompts, won't fill secret fields and won't act on a stale tree. | Per-site permissions. Some actions, such as purchases and account creation, are refused in every mode. |

The Claude in Chrome column quotes Anthropic's own pages, read on 2026-11-14. The quotes are in [docs/research](docs/research/claude-in-chrome-2026-11-14.md).

**Choose chrome-control when:**
- a step repeats and you want it to run the same way each time;
- you don't want an extension, a debugging port or a copied profile;
- you want to keep working in your editor while the browser step runs;
- your agent isn't Claude, or you use Claude Code without the extension.

**Choose Claude in Chrome when:**
- you need the DOM, JavaScript, the console, file uploads, screenshots or recordings;
- you're on Windows or Linux, or you use a browser other than Chrome;
- you want Claude to work out the steps on a page nobody has scripted.

## How it works
1. **It finds your Chrome:** the Chrome process started without `--user-data-dir`. Playwright, Puppeteer and agent browsers start Chrome with one. It never addresses Chrome by bundle id, which could reach one of those instead.
2. **It finds your profile's window** by its accessibility title, `… - Google Chrome - <name> (<profile>)`. You keep one window with `use <id>`.
3. **It reads** that window's accessibility tree through [cua-driver](https://github.com/trycua/cua) and prints it as lines: `[index] Role "label"`.
4. **It acts on one element.** `press` and `fill` find the single element with that exact label. You can narrow the search with a role, or with the text of a table row. cua-driver then performs the press, or sets the value, on that element in the background.
5. **It opens pages in a new tab.** `open <url>` presses the window's own New Tab button. It then sets that tab's address by an Apple Event sent to your Chrome's process id. This step brings Chrome forward.

## Rules it keeps
- **No app is put back in front.** Every command except `open` works behind the app you have in front. If the front app changes during a command, the tool says so and leaves it.
- **Passwords and passkeys are yours.** A page that asks for one ends the command with exit 2. A field whose label reads like a secret is never filled.
- **One match or nothing.** If a label is on the page twice, or a title is on two tabs, the command is refused rather than guessed.
- **No acting on an old tree.** Chrome can stop updating a page's tree while another app covers its window, even though the tab's title keeps changing. If the tab's title and the page's title disagree, `press`, `fill`, `click` and `key-to-env` refuse with exit 3, and `read` warns.
- **Keys stay unprinted.** `key-to-env` writes the one text on the page that matches your pattern into `.env`, and prints only its length.
- **Nothing leaves your profile.** The tool copies no cookies, keeps no session store and starts no Chrome of its own.

## Install
You need macOS 14 or later, Google Chrome and Node 22 or later.

1. Install cua-driver and grant its permissions. The command below runs Cua's installer script; read it first if you like.
   ```sh
   /bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"
   cua-driver permissions grant      # switch on Accessibility and Screen & System Audio Recording
   cua-driver permissions status
   ```
2. Get the tool:
   ```sh
   git clone https://github.com/CryptoKrad/chrome-control
   cd chrome-control && node --test
   ```
3. The first `open` makes macOS ask whether your terminal may control Google Chrome. Allow it.

## Set up
- **Pick a profile.** If Chrome has one profile, there is nothing to set. Otherwise set `OWNER_CHROME_PROFILE` to the profile's folder name, either in your environment or in a `.env` file in the folder you run the tool from (`OWNER_CHROME_PROFILE="Profile 1"`). `chrome://version` shows the folder at the end of "Profile Path".
- **Keep one window.** Run `windows` to list the profile's windows, then `use <id>` to keep one. The choice is saved in `.local/chrome-control.json`. Keep `.env` and `.local/` out of git.

## Commands
| Command | What it does |
|---|---|
| `windows` | List the profile's windows: id and title. |
| `use <id>` | Keep that window for every later command. |
| `read [lines]` | Print the page as an accessibility tree. The default is 60 lines. |
| `press "<label>" [role] ["<row text>"]` | Press the one element with that label, such as a button, link or tab. A role (`AXButton`, `AXLink`) and a table row's text narrow it. |
| `fill "<label>" <text> [role]` | Set a field's value. A secret field is refused. |
| `click <x> <y>` | Click at a pixel of the window's capture, for something that has no label. |
| `open <url>` | Open the address in a new tab of the kept window. This brings Chrome forward. |
| `close-tab "<title>"` | Close the one tab with that title. |
| `key-to-env <NAME> '<regex>'` | Write the one text on the page that matches into `.env` as `NAME`, without printing it. |
| `stop` | Stop cua-driver. |

Name the role when a label repeats: the window's tree also holds Chrome's menu bar, which has items such as "New Tab".

**Exit codes:**
- 0: done.
- 1: refused, for example because nothing or more than one thing matched, or no window is kept.
- 2: your step, because the page asks for a password or passkey, or the field is a secret.
- 3: the tree is stale.

## Use it from an AI agent
Any agent that can run a shell command can use the tool. You can paste this into `CLAUDE.md` or `AGENTS.md`:

```text
Browser steps in my own Chrome go through chrome-control (/path/to/chrome-control/chrome-control.mjs).
- Run `read 200` first, and act only on labels you saw in that read.
- `press "<label>" AXButton` and `fill "<label>" <text>`. Never guess a label.
- Exit 2 is a password or passkey: stop and ask me. Exit 3: Chrome has not updated the page;
  run `open <url>` or ask me to bring Chrome forward.
- Never type a secret into a page. `key-to-env` moves a key into .env without printing it.
```

In Claude Code you can allow reads without a prompt and keep a prompt for actions. Add this to `.claude/settings.json`, using absolute paths:

```json
{ "permissions": { "allow": ["Bash(node /path/to/chrome-control/chrome-control.mjs read *)", "Bash(node /path/to/chrome-control/chrome-control.mjs windows)"] } }
```

## Limits
- **macOS and Google Chrome only.** Edge, Brave and Arc are not supported. It needs cua-driver with its two permissions.
- **No keyboard.** A background key press can land in another window while Chrome has several open, so cua-driver refuses it. Press the page's Search button instead of Return.
- **Fields are set, not typed.** `fill` sets a field's value through Accessibility, the way assistive technology does. It has worked on the consoles it was used with, but a page that only listens for key presses may not notice.
- **Only labelled elements.** Something with no label, or a label that repeats with no role or row to tell the copies apart, cannot be pressed by label. Use `click x y`.
- **Covered windows can go stale.** While another app covers its window, Chrome can stop updating the page's tree. The tool refuses to act then, and `open` brings Chrome forward. Chrome's `--disable-backgrounding-occluded-windows` flag turns off that backgrounding, but it was not tested with this tool.
- **No page internals.** It has no access to the DOM, JavaScript, the console, the network or downloads.
- **Tested on one setup.** It was measured on one Mac with a signed-in profile. The window titles of a signed-out profile, or of a Chrome with one profile, follow Chrome's naming but were not measured.

## Test
```sh
node --test
```
The tests cover the pure rules: which window is yours, what a label matches, when a tree is stale and what goes into `.env`. They run without Chrome or cua-driver, and CI runs them on every push.

## License
MIT. See [LICENSE](LICENSE). "Chrome" is Google's trademark and "Claude" is Anthropic's. They are named here only to say what this tool works with and what it compares with.
