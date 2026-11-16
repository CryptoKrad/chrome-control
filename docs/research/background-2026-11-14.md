# Q: What works in a Chrome window that is not in front, and what stops it?

2026-11-14. Measured on one Mac: macOS (Darwin 25.2), Google Chrome 157.0.8103.51, cua-driver 0.24.0, an editor in front. Every test ran in a throwaway Chrome on an empty temp profile (`--user-data-dir`), on the lab page in `lab/site/`. The page writes its own state into its title every second (`document.visibilityState`, a timer, the last input events, the field values), so the title is the page's truth and the accessibility tree can be checked against it. The scripts are in `lab/`; `lab/e2e.mjs` repeats the tool's own run.

## Results

| # | Case | Result |
|---|---|---|
| 1 | A Chrome started by cua-driver's `launch_app` as a new instance on its own data folder | Stayed behind the front app, 7 launches of 7. |
| 2 | One Chrome window, behind another app. Read, press (`AXPress`), `set_value`, `type_text`, `press_key` Return | All landed and the front app never changed. `set_value` fired trusted `input` and `change` events. `type_text` fired `keydown`, `beforeinput`, `input` for each character. Return submitted the form. |
| 3 | The same with two windows in that Chrome process | Press and `set_value` worked. `type_text`, `press_key` and `scroll` were refused: `same_pid_keyboard_ambiguity`, for either window. |
| 4 | The window fully behind another app's window (the editor's, and a full-size window of a second Chrome process) | `visibilityState` stayed `visible` and the tree stayed current, for the 60 s watched. |
| 5 | The window fully under another window of the same Chrome process | `hidden` within 2 s. The tree stopped (its timer text and its page title froze) while the tab's title went on. `requestAnimationFrame` callbacks did not run. A press and a `set_value` still landed: the click handler ran and `input` and `change` fired. After each of them the tree showed the page as it was just before that action. A read alone, an action the element does not support, and a press on plain text did not refresh it. |
| 6 | The same, then the cover made smaller so part of the window showed on screen | `visible` within 3 s, the tree current, the waiting frame callback ran. A strip that only showed past the screen's edge did not count: still hidden. |
| 7 | Case 5 in a Chrome started with `--disable-backgrounding-occluded-windows` | Stayed `visible`. The tree stayed current and a press showed at once. |
| 8 | One window: the address bar set by `set_value`, then Return | Navigated, in the current tab and in a new tab made by the New Tab button. The front app did not change. |
| 9 | JavaScript for Automation, `Application(<pid>)`, with the lab's pid | Reached the default Chrome, not the pid. Its `make` of a window brought that Chrome to the front. Scripting Bridge's `applicationWithProcessIdentifier` does address a pid (used by `open`). |
| 10 | cua-driver's `invoke_menu` (File, New Window) | Delivered in its foreground mode: that Chrome came to the front. |
| 11 | The first reads of a new browser | The page's tree came back empty for some seconds after the first accessibility request, then filled. |
| 12 | `--load-extension` on Chrome 157 | Ignored, so no extension could be loaded into the lab. In a real window the toolbar lists each pinned extension and the Extensions button as an `AXPopUpButton` with a press action. A pinned extension named itself on two lines. |
| 13 | A toolbar bubble (site information) opened by a background press | Nothing new in the window's tree. Where a bubble or an extension's popup is exposed was not found. |
| 14 | A popup the page opened with no user gesture (`--disable-popup-blocking`) | Shown without activating Chrome, second from the front. This is how the lab got a second same-process window without taking the screen. |
| 15 | A one-profile Chrome's window title in the tree | `<page> - Google Chrome`, with no profile named. |
| 16 | A page whose title changes every second | The tab's title can run one tick ahead of the tree's. Read twice a second apart, a live tree moves and a stopped one does not. |
| 17 | The address bar's suggestions | Once the bar had taken a key, `set_value` on it made Chrome show its suggestion list. The list is an untitled window of its own in the process (a web area named "Omnibox Popup"), so cua-driver counted two windows and refused Return. The list's first row is the address typed, as `<address>, 1 of 2`, and a bare origin without its last slash. Pressed in the list's own window it navigated, in the background. Addressed through the browser window it was refused (`element_outside_target_window`). |
| 18 | The same in a Chrome with two real windows, in a new tab | No list showed, before or after a press on the bar, and Return was refused. |
| 19 | Scripting Bridge by pid, setting the URL of a new tab | The page opened and that Chrome became the front app, 3 of 3, read by pid. |

## What the tool does with it
- Case 5 is the stale tree of 2026-11-14 morning. Its cause is Chrome's own check of its windows, not the app in front (case 4). The tool computes the same thing from the windows' frames and order (`covered`) and refuses to act in a covered window, exit 3. With the flag of case 7 it skips the check. `doctor` says which state the browser is in.
- Cases 2 and 3: `fill` uses `set_value`. `type` and `key` use the key route and say plainly when cua-driver refuses it. The tool never falls back to a foreground key.
- Cases 8, 17, 18 and 19: `open` works in the background when the Chrome has one window, by Return or, once the list shows, by pressing the list's row for that exact address and no other row. With several windows it keeps the Apple Event of the earlier version, which brings Chrome forward, and says so.
- The front app is compared by pid, since two Chromes share a name.
- Cases 1, 2, 4 and 7 together: a Chrome of the tool's own (`launch <name>`) has one window, takes keys, is never covered by a sibling window and starts behind the front app. Each agent can have one.
- Case 9 is why nothing in the tool addresses Chrome by name, bundle id or `Application()`.
- Case 16: `stillStale` reads twice before it calls a tree old.

## Other tools read on the way
- Hermes Agent (a local install, `tools/browser_tool_real_profile.py`): "snapshot the user's default Chromium profile into a hermes-owned copy, launch the real browser binary on it, and attach agent-browser". Its Chrome ran headless with `--remote-debugging-port=0`. It also has an extension lane (`tools/browser_extension_router.py`) and keeps a snapshot inside a character budget by cutting at line ends and storing the full tree in a file (`tools/browser_tool_snapshot.py`).
- A copied profile was tried once outside this tool on 2026-11-14: the sites saw the same session from a second browser and ended it in the real one. This tool copies nothing, and works in the real window or in an empty profile you sign in to yourself.
- cua-driver has its own DevTools-based browser tools (`browser_prepare`, `get_browser_state`, `browser_click`, `browser_type`). They need a DevTools endpoint; attaching one to an existing profile is a setting cua-driver asks the user to grant. This tool does not use them.

## Size of a read
One Search Console page, the same moment: 38,321 characters as the tree the earlier `read 3000` printed, 2,261 as `read` prints it now (80 lines). The lab page: 17 lines.

## Not measured
- A window on another Space, and a minimized window. The tool says so (`OFF`) and does not refuse.
- A second display. `covered` asks a window on another display whole.
- Other browsers, other macOS versions, and how long case 4 holds past a minute.

## Edge cases (W28, measured 2026-11-16)
- **A minimized window.** `hiddenOf` returns "off" when `list_windows` reports the window is not on screen, and a minimized window is not on screen, so acting commands warn/refuse. One nuance: a `launch` browser carries `--disable-backgrounding-occluded-windows`, and with that flag `hiddenOf` returns null (it trusts the flag to keep windows live). The flag is about occlusion, not minimization, so a minimized window in a flagged Chrome reads as "live" though its tree is stale. Minimize is rare for an automated browser; noted as a known gap, not fixed.
- **A window on another Space.** Same path: off-Space windows report not-on-screen, so "off". Not separately reproduced.
- **A second display.** Not testable here (one display). `covered()` builds the screen rectangle from `get_screen_size` (the primary display), so a window wholly on a secondary display could be mis-assessed. Known untested gap; needs the hardware.
- **An extension popup or toolbar bubble.** Chrome 157 ignored `--load-extension` in the lab, so no extension could be loaded. In a real window the toolbar lists each pinned extension as an `AXPopUpButton` that `press` can press, but what opens (a popup or a bubble) did not appear in the window's accessibility tree (measured 2026-11-14). So the tool can press an extension button but cannot drive what it opens.
- No new rule emerged: the tool already handles the on-screen cases conservatively. These are documented limits, not code changes.
