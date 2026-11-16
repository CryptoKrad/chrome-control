// chrome-control: it finds the profile's own Chrome window, presses an element only by a label that is on the page
// once, never fills a secret field, stops at a password or passkey prompt, writes a key into .env only when exactly one
// text on the page is that key, refuses to act on a tree Chrome has not updated, opens a page only in a new tab of the
// kept window and never puts an app back in front. It prints a page as short lines and an action as what it changed,
// refuses a window Chrome treats as hidden, and keeps one window for one session.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { windowOf, keptWindow, elementOf, onlyMatch, withEnv, tabOf, OWNER_STEP, ownChrome, pageOf, sameTitle, rowOf, ofProfile, profileOf, staleOf, stillStale, suggestionOf, oneLine, compact, changed, covered, claim, lock, FLAG, USAGE } from "./chrome-control.mjs";

const src = readFileSync(new URL("./chrome-control.mjs", import.meta.url), "utf8");
const tree = [
  '- [0] AXWindow "API access - Google Chrome - Sam (Work)"',
  '  - [24] AXWebArea "Home - Example Console"',
  '    - [39] AXButton "Generate API Key" (Generate API Key) [actions=[press]]',
  '    - [40] AXStaticText = "0123456789abcdef0123456789abcdef"',
  '    - [41] AXLink "Learn more" (Learn more)',
  '    - [42] AXLink "Learn more" (Learn more)',
].join("\n");

test("the profile's window is the one whose title ends with the profile's name; two or none is no window", () => {
  const ws = [{ window_id: 1, title: "Mail - Google Chrome - Alex" }, { window_id: 2, title: "Console - Google Chrome - Sam (Work)" }];
  assert.equal(windowOf(ws, "Work").window_id, 2);
  assert.equal(windowOf([...ws, { window_id: 3, title: "X - Google Chrome - Sam (Work)" }], "Work"), null);   // two: no guess
  assert.equal(windowOf(ws, "Home"), null);
  // a profile with no one signed in is named alone; with one profile, Chrome may name no one
  assert.equal(ofProfile("Mail - Google Chrome - Work", "Work"), true);
  assert.equal(ofProfile("Mail - Google Chrome - Sam (Work)", "Work"), true);
  assert.equal(ofProfile("Mail - Google Chrome - Sam (Home)", "Work"), false);
  assert.equal(ofProfile("Mail - Google Chrome - Network", "Work"), false);   // a name that only ends like it
  assert.equal(ofProfile("Mail - Google Chrome", "Work"), false);
  assert.equal(ofProfile("Mail - Google Chrome", "Work", true), true);
  assert.equal(windowOf([{ window_id: 5, title: "Mail - Google Chrome" }], "Person 1", true).window_id, 5);
});

test("the profile is the folder named, or the only one Chrome has; several and none named is no profile", () => {
  const cache = { Default: { name: "Person 1" }, "Profile 1": { name: "Work" } };
  assert.deepEqual(profileOf(cache, "Profile 1"), { dir: "Profile 1", name: "Work", only: false });
  assert.equal(profileOf(cache, ""), null);
  assert.equal(profileOf(cache, "Profile 9"), null);
  assert.deepEqual(profileOf({ Default: { name: "Person 1" } }, undefined), { dir: "Default", name: "Person 1", only: true });
  assert.equal(profileOf(undefined, "Default"), null);
});

test("the kept window is used while it is open and the profile's; otherwise the one-window rule", () => {
  const ws = [{ window_id: 431, title: "Mail - Google Chrome - Sam (Work)" }, { window_id: 977, title: "Docs - Google Chrome - Sam (Work)" }];
  assert.equal(keptWindow(ws, { window_id: 431 }, "Work").window_id, 431);
  assert.equal(keptWindow(ws, { window_id: 9 }, "Work"), null);   // closed since, and two are open: no guess
  assert.equal(keptWindow(ws.slice(1), { window_id: 9 }, "Work").window_id, 977);
  assert.equal(keptWindow([{ window_id: 431, title: "Mail - Google Chrome - Alex" }], { window_id: 431 }, "Work"), null);   // another profile now
});

test("an element is pressed only by a label that is on the page once, and a press can name the role", () => {
  assert.equal(elementOf(tree, "Generate API Key"), 39);
  assert.equal(elementOf(tree, "Learn more"), null);
  assert.equal(elementOf(tree, "Delete"), null);
  // the window's tree also holds Chrome's menu bar: two "New Tab" menu items beside the tab strip's button
  const menus = ['  - [266] AXButton "New Tab" (New Tab) [actions=[press,showmenu]]', '      - [364] AXMenuItem "New Tab" [id=commandDispatch: actions=[cancel,press,pick]]', '          - [424] AXMenuItem "New Tab" [id=openHistoryMenuItem: actions=[cancel,press,pick]]'].join("\n");
  assert.equal(elementOf(menus, "New Tab", "AXButton"), 266);
  assert.equal(elementOf(menus, "New Tab"), null);
  // a scope picker that shows only its value (Cloudflare's token policy, 2026-11-14): named by role and value, or by value alone when one of the lines can be pressed
  const scope = ['    - [101] AXComboBox = "Entire Account" [actions=[press]]', '      - [102] AXStaticText = "Entire Account" [actions=[showmenu]]'].join("\n");
  assert.equal(elementOf(scope, "Entire Account", "AXComboBox"), 101);
  assert.equal(elementOf(scope, "Entire Account"), 101);   // of two lines, only one can be pressed
  const domains = ['      - [107] AXStaticText = "example.ca" [actions=[press,showmenu,scrolltovisible]]', '        - [108] AXStaticText = "example.ca" [actions=[showmenu,scrolltovisible]]'].join("\n");
  assert.equal(elementOf(domains, "example.ca", "AXStaticText"), 107);
  assert.equal(elementOf(menus.replace("AXButton", "AXMenuItem"), "New Tab"), null);   // three that can be pressed: none
  assert.equal(elementOf(menus, "New Tab", "button"), 266);   // the role as `read` prints it
  assert.equal(elementOf(menus, "New Tab", "axbutton"), 266);
  assert.equal(elementOf(tree, "Generate API\u2026"), 39);   // a label `read` cut at 160 characters
  assert.equal(elementOf(menus, "New\u2026"), null);   // an opening on three lines: none
  assert.match(src, /const label = cmd === "key" \? b : a, role = \(cmd === "press" \? b : c\) \?\? ""/);
  assert.match(src, /const idx = label \? elementOf\(scope, label, role\) : null/);
});

test("a key goes to .env only when exactly one text is the key, and the other lines stay", () => {
  assert.equal(onlyMatch(tree, "[0-9a-f]{32}"), "0123456789abcdef0123456789abcdef");
  assert.equal(onlyMatch(tree + '\n- [50] AXStaticText = "ffffffffffffffffffffffffffffffff"', "[0-9a-f]{32}"), null);
  assert.equal(withEnv("A=1\nEXAMPLE_API_KEY=old\n", "EXAMPLE_API_KEY", "new"), "A=1\nEXAMPLE_API_KEY=new\n");
  assert.equal(withEnv("", "PW", "abcd efgh"), "PW='abcd efgh'\n");   // spaced values stay one shell word
});

test("a tab is closed only by a title on one tab, and only once it is the active tab", () => {
  // the tab strip as Chrome gives it (labels carry the memory note inside the quotes)
  const strip = [
    '    - [720] AXRadioButton "URL Inspection - Memory usage - 268 MB" (URL Inspection - Memory usage - 268 MB)',
    '    - [728] AXRadioButton "Account - Inactive tab - 51.6 MB freed up" (Account - Inactive tab - 51.6 MB freed up)',
    '    - [736] AXRadioButton "Overview - Memory usage - 206 MB" (Overview - Memory usage - 206 MB)',
    '    - [737] AXRadioButton "Overview of reports - Memory usage - 40 MB" (Overview of reports - Memory usage - 40 MB)',
    '    - [739] AXRadioButton "Notes - Inactive tab - 161 MB freed up" (Notes - Inactive tab)',
    '    - [740] AXRadioButton "Notes - Inactive tab - 133 MB freed up" (Notes - Inactive tab)',
  ].join("\n");
  assert.equal(tabOf(strip, "URL Inspection"), 720);
  assert.equal(tabOf(strip, "Account"), 728);
  assert.equal(tabOf(strip, "Overview"), 736);   // not "Overview of reports"
  assert.equal(tabOf(strip, "Notes"), null);   // two tabs of one title: neither is closed
  assert.equal(tabOf(strip, "Mail"), null);
  assert.match(src, /if \(!\(\/AXWindow "\(\[\^"\]\*\)"\/\.exec\(lines\(\)\[0\]\)\?\.\[1\] \?\? ""\)\.startsWith\(`\$\{a\} - Google Chrome`\)\) \{ console\.log\(`"\$\{a\}" did not become the active tab; nothing closed`\); process\.exit\(1\); \}/);
});

test("a password or passkey prompt is the user's step, and a secret field is never filled", () => {
  assert.match("Complete sign-in using your passkey", OWNER_STEP);
  assert.match("Enter your password", OWNER_STEP);
  assert.doesNotMatch("Choose an account", OWNER_STEP);
  assert.match(src, /\(cmd === "fill" \|\| cmd === "type"\) && SECRET_FIELD\.test\(a\)/);
  assert.doesNotMatch(src, /Cookies|Login Data|cpSync|copyFile/);   // nothing is copied from a profile
  // the only Chrome the tool starts is its own, on an empty folder of its own, in the background
  assert.equal(src.match(/--user-data-dir=/g).length, 3);
  assert.match(src, /const dir = path\.join\(BROWSERS, a\);/);
  assert.match(src, /additional_arguments: \[`--user-data-dir=\$\{dir\}`, "--no-first-run", "--no-default-browser-check", FLAG,/);
  assert.match(src, /p\.args\.includes\(`--user-data-dir=\$\{path\.join\(BROWSERS, browser\)\} `\)/);
});

test("open reaches only your own Chrome by pid, as a new tab of the kept window; nothing is put back", () => {
  // measured: a launch raised Chrome, a menu item is delivered in the foreground, and JavaScript for Automation's
  // Application(<pid>) reached the default Chrome, not the pid it was given
  assert.doesNotMatch(src, /"-na"|--new-window|bring_to_front|activate|invoke_menu|"-a", "Google Chrome"|application id|\bApplication\(/);
  assert.equal(src.match(/launch_app/g).length, 1);   // only `launch`, a new instance on the tool's own folder: your own Chrome is never launched into
  assert.match(src, /cua\("launch_app", \{ bundle_id: "com\.google\.Chrome", creates_new_application_instance: true,/);
  // the address goes into a new tab's bar, and the bar's own suggestion for it is pressed in the suggestions' window: no
  // key is sent. The list as the lab gave it, 2026-11-14:
  const list = ['- [0] AXWindow [actions=[raise]]', '  - [1] AXWebArea "Omnibox Popup" [actions=[showmenu,scrolltovisible]]', '    - [2] AXList [actions=[showmenu,scrolltovisible]]',
    '      - [3] AXStaticText = "http://127.0.0.1:8765/index.html, 1 of 2" [actions=[press,showmenu,scrolltovisible]]',
    '      - [4] AXStaticText = "http://127.0.0.1:8765/index.html search, 2 of 2" [actions=[press,showmenu,scrolltovisible]]'].join("\n");
  assert.equal(suggestionOf(list, "http://127.0.0.1:8765/index.html"), 3);
  assert.equal(suggestionOf(list, "http://127.0.0.1:8765/"), null);   // another address is never pressed
  assert.equal(suggestionOf(list.replace(/^.*1 of 2.*\n/m, ""), "http://127.0.0.1:8765/index.html"), null);   // the search row alone is not the address
  assert.equal(suggestionOf('      - [3] AXStaticText = "https://example.com, 1 of 2" [actions=[press,showmenu]]', "https://example.com/"), 3);   // a bare origin is listed without its slash
  assert.equal(suggestionOf(`${list}\n${list}`, "http://127.0.0.1:8765/index.html"), null);   // offered twice: none
  assert.equal(suggestionOf(list.replace(/press,/g, ""), "http://127.0.0.1:8765/index.html"), null);
  assert.match(src, /const row = \/AXWebArea "Omnibox Popup"\/\.test\(list\.tree_markdown \?\? ""\) \? suggestionOf\(list\.tree_markdown, a\) : null;/);
  assert.match(src, /if \(rows\.length === 1\) cua\("click", \{ \.\.\.rows\[0\], action: "press" \}\);\n    else if \(/);
  assert.match(src, /if \(bar === null \|\| titleOf\(s\) !== "New Tab"\) \{[^\n]*process\.exit\(1\)/);
  assert.match(src, /const id = appleEvent\("id", t\.pid, "New Tab"\), r = \/\^\\d\+\$\/\.test\(id\) \? appleEvent\("go", t\.pid, id, a\) : id;/);   // the last resort, said when taken
  assert.match(src, /applicationWithProcessIdentifier\(Number\(pid\)\)/);
  assert.match(src, /if \(hits\.length !== 1\) return/);
  assert.match(src, /if \(!String\(ObjC\.unwrap\(tab\.valueForKey\("URL"\)\)\)\.startsWith\("chrome:\/\/newtab"\)\) return/);   // only a new tab is navigated
  assert.match(src, /elementOf\(s\.tree_markdown, "New Tab", "AXButton"\)/);
  assert.match(src, /process\.on\("exit", \(\) => \{ const now = front\(\); if \(now !== before\)/);
  assert.equal(pageOf("Overview - Google Chrome - Sam (Work)"), "Overview");
  assert.equal(pageOf("A - Google Chrome - B - Google Chrome - Sam (Work)"), "A - Google Chrome - B");
  assert.equal(pageOf("Overview - Google Chrome"), "Overview");   // one profile: no one named
});

test("a press can be held to the one table row that holds a text (a table is also exposed by column)", () => {
  const table = [
    '    - [94] AXTable [actions=[showmenu]]',
    '      - [95] AXRow [actions=[showmenu]]',
    '          - [98] AXLink "old-token" (old-token) [actions=[press,showmenu]]',
    '          - [110] AXPopUpButton "Token actions" (Token actions) [actions=[press,showmenu]]',
    '      - [127] AXRow [actions=[showmenu]]',
    '          - [130] AXLink "new-token" (new-token) [actions=[press,showmenu]]',
    '          - [150] AXPopUpButton "Token actions" (Token actions) [actions=[press,showmenu]]',
    '      - [199] AXColumn [actions=[showmenu]]',
    '          - [206] AXLink "new-token" (new-token) [actions=[press,showmenu]]',
    '          - [300] AXPopUpButton "Token actions" (Token actions) [actions=[press,showmenu]]',
  ].join("\n");
  assert.equal(elementOf(table, "Token actions", "AXPopUpButton"), null);
  assert.equal(elementOf(rowOf(table, "new-token"), "Token actions", "AXPopUpButton"), 150);
  assert.equal(elementOf(rowOf(table, "old-token"), "Token actions", "AXPopUpButton"), 110);
  assert.equal(rowOf(table, "missing"), null);
  assert.equal(rowOf(table + '\n      - [400] AXRow [actions=[showmenu]]\n          - [401] AXLink "new-token"', "new-token"), null);   // two rows: none
});

test("Chrome's elided window name matches the full title only by its opening, its ending and its pieces in order", () => {
  const full = "Tokens | sam.k@example.com's Account | Example";
  assert.equal(sameTitle("Tokens | sam.k\u2026mple.com's Account | Example", full), true);
  assert.equal(sameTitle(full, full), true);
  assert.equal(sameTitle("Tokens | sam.k\u2026mple.com's Account | Other", full), false);
  assert.equal(sameTitle("Keys | sam.k\u2026mple.com's Account | Example", full), false);
  assert.equal(sameTitle("Tokens | sam.k\u2026Account\u2026Example", full), true);
  assert.equal(sameTitle("Tokens | sam.k\u2026Example\u2026Account | Example", full), false);   // pieces out of order
  assert.equal(sameTitle("Tokens | sam.k\u2026Billing\u2026Example", full), false);   // a piece the title does not hold
  assert.equal(sameTitle("Tokens | sam.k@example", full), false);   // no ellipsis: equal or nothing
  assert.match(src, /sameTitle\(String\(ObjC\.unwrap\(w\.valueForKey\("name"\)\)\), key\)/);
});

test("your Chrome is the one without its own --user-data-dir (an automation Chrome has one)", () => {
  const own = { pid: 4242, args: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" };
  const bot = { pid: 4242, args: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/agent-profile --remote-debugging-port=0" };
  assert.equal(ownChrome([own, bot]), 4242);
  assert.equal(ownChrome([bot, own]), 4242);
  assert.equal(ownChrome([bot]), null);
  assert.equal(ownChrome([own, { ...own, pid: 9 }]), null);
});

test("a tree Chrome has not updated is told by the tab's title, and no press, fill, click or key is read off it", () => {
  // a window covered by an editor, as read: the tab had moved on to the inspection, its tree had not
  const stale = ['- [0] AXWindow "URL Inspection - Google Chrome - Sam (Work)" [actions=[raise]]', '  - [24] AXWebArea "Performance on Search generative AI features" [actions=[showmenu,scrolltovisible]]'].join("\n");
  assert.deepEqual(staleOf(stale), { tab: "URL Inspection", page: "Performance on Search generative AI features" });
  assert.equal(staleOf(['- [0] AXWindow "Overview - Google Chrome - Sam (Work)"', '  - [24] AXWebArea "Overview"'].join("\n")), null);
  assert.equal(staleOf(['- [0] AXWindow "New Tab - Google Chrome"', '  - [22] AXWebArea "New Tab"', '    - [23] AXWebArea'].join("\n")), null);
  assert.equal(staleOf(['- [0] AXWindow "example.com/a - Google Chrome - Sam (Work)"', '  - [22] AXWebArea [actions=[showmenu]]'].join("\n")), null);   // a page with no title
  assert.deepEqual(staleOf(tree), { tab: "API access", page: "Home - Example Console" });
  assert.match(src, /acts = \["press", "fill", "type", "key", "click", "key-to-env", "wait"\]\.includes\(cmd\)/);
  // a page whose title ticks (the lab's, every second) is read between two ticks: old only when a second read, a second later, holds the same page
  const tick = (tab, page) => staleOf([`- [0] AXWindow "lab t${tab} - Google Chrome"`, `  - [7] AXWebArea "lab t${page}"`].join("\n"));
  assert.equal(stillStale(tick(52, 51), tick(53, 53)), null);
  assert.equal(stillStale(tick(52, 51), tick(53, 52)), null);   // the tree moved: live
  assert.deepEqual(stillStale(tick(52, 2), tick(53, 2)), { tab: "lab t53", page: "lab t2" });   // the hidden lab page: its tree stayed at t2
  assert.match(src, /if \(stale\) \{ sleep\(1\); s = snapshot\(t\); stale = stillStale\(stale, staleOf\(s\.tree_markdown\)\); \}/);
  assert.match(src, /if \(stale && acts\) \{ console\.log\(STALE\(stale\)\); process\.exit\(3\); \}/);
});

// the lab page of docs/research/background-2026-11-14.md as cua-driver gave it, with a toolbar and an extension's button
const lab = [
  '- [0] AXWindow "Lab - Google Chrome - Sam (Work)" [actions=[raise]]',
  '    - [1] AXButton "Reload" (Reload) [actions=[press,showmenu]]',
  '    - [3] AXTextField "Address and search bar" = "127.0.0.1:8765" (Address and search bar) [actions=[press,showmenu]]',
  '    - [7] AXPopUpButton "Open Helper',
  'Has access to this site" (Open Helper',
  'Has access to this site) [actions=[press,showmenu]]',
  '    - [8] AXPopUpButton "Extensions" (Extensions) [actions=[press,showmenu]]',
  '  - [9] AXWebArea "Lab" [actions=[showmenu,scrolltovisible]]',
  '    - [10] AXHeading "Lab one" [actions=[showmenu,scrolltovisible]]',
  '      - [11] AXStaticText = "Lab one" [actions=[showmenu,scrolltovisible]]',
  '    - AXGroup',
  '      - [12] AXStaticText = "timer 16" [actions=[showmenu,scrolltovisible]]',
  '    - [13] AXTextField "Plain field" [actions=[press,showmenu,scrolltovisible]]',
  '    - [18] AXButton "Sync view" [actions=[press,showmenu,scrolltovisible]]',
  '    - [21] AXLink "Second page" (Second page) [actions=[press,showmenu,scrolltovisible]]',
  '      - [22] AXStaticText = "Second page" [actions=[showmenu,scrolltovisible]]',
  '    - [30] AXTable [actions=[showmenu]]',
  '      - [31] AXRow [actions=[showmenu]]',
  '        - [32] AXCell',
  '          - [33] AXStaticText = "alpha" [actions=[showmenu,scrolltovisible]]',
  '      - [34] AXColumn',
  '        - [35] AXCell',
  '          - [36] AXStaticText = "alpha" [actions=[showmenu,scrolltovisible]]',
  '  - [26] AXButton "New Tab" (New Tab) [actions=[press,showmenu]]',
  '      - [364] AXMenuItem "New Tab" [id=commandDispatch: actions=[cancel,press,pick]]',
].join("\n");

test("a page prints as short lines: no index, action list, repeated label, unnamed group or column copy of a table", () => {
  const page = compact(oneLine(lab));
  assert.deepEqual(page, ['heading "Lab one"', '"timer 16"', 'textfield "Plain field"', 'button "Sync view"', 'link "Second page"', "table", " row", '  "alpha"']);
  assert.ok(page.join("\n").length < oneLine(lab).length / 4);   // the same page for a quarter of the characters
  // the browser's own controls are asked for apart, with an extension's two-line button name on one line, and no menu
  assert.deepEqual(compact(oneLine(lab), true), ['button "Reload"', 'textfield "Address and search bar" = "127.0.0.1:8765"', 'popupbutton "Open Helper Has access to this site"', 'popupbutton "Extensions"', 'button "New Tab"']);
  assert.equal(elementOf(oneLine(lab), "Open Helper Has access to this site", "popupbutton"), 7);
  assert.equal(elementOf(lab, "Open Helper Has access to this site"), null);   // unjoined, the label is on no line
  // a page's own menu is the page's: only the browser's menus are left out
  assert.deepEqual(compact(['- [0] AXWindow "A"', '  - [1] AXWebArea "A"', '    - [2] AXMenu "Actions"', '      - [3] AXMenuItem "Rename"'].join("\n")), ['menu "Actions"', ' menuitem "Rename"']);
  const long = compact(['- [0] AXWindow "A"', '  - [1] AXWebArea "A"', `    - [2] AXLink "${"x".repeat(200)}"`].join("\n"))[0];
  assert.equal(long.length, 160);
  assert.ok(long.endsWith("\u2026"));
  assert.equal(elementOf(`    - [2] AXLink "${"x".repeat(200)}" [actions=[press]]`, long.slice(6)), 2);   // what was printed presses it
  assert.deepEqual(compact('- [0] AXWindow "A"'), []);   // no page read yet
  // a form as the lab page gave it: a label's text names the field after it, and a text with nothing in it says nothing
  const form = ['- [0] AXWindow "A"', '  - [7] AXWebArea "A"', '    - [12] AXStaticText = "Plain field" [actions=[showmenu]]', '    - [13] AXTextField "Plain field" = "hello" [actions=[press]]', '    - [14] AXStaticText = "events none" [actions=[showmenu]]', '    - [16] AXTextField "Search box" [actions=[press]]', '    - [26] AXStaticText [actions=[showmenu,scrolltovisible]]'].join("\n");
  assert.deepEqual(compact(form), ['textfield "Plain field" = "hello"', '"events none"', 'textfield "Search box"']);
  assert.match(src, /if \(waited >= 8 \|\| compact\(s\.tree_markdown\)\.length\) break;/);   // a new browser's first reads come back empty: asked again, eight seconds at most
});

test("an action prints what it changed, not the page again", () => {
  const before = ['heading "Lab one"', '"view start"', 'button "Sync view"', '"row"', '"row"'];
  assert.deepEqual(changed(before, ['heading "Lab one"', '"view sync"', 'button "Sync view"', '"row"']), { added: ['"view sync"'], gone: 2 });
  assert.deepEqual(changed(before, before), { added: [], gone: 0 });
  assert.deepEqual(changed(['"row"'], [' "row"', '"row"']), { added: ['"row"'], gone: 0 });   // a line twice is two lines; indent is not a change
  assert.match(src, /if \(addressOf\(s\) !== was\.address\) return head\(t, s\);/);   // another address: the new page's head, 25 lines (a title may tick)
  assert.match(src, /sleep\(cmd === "press" \? 4 : 2\); s = snapshot\(t\); report\(t, was, s\); process\.exit\(0\);/);
  assert.match(src, /const limit = Math\.min\(Number\(b\) \|\| 20, 300\);/);   // wait is bounded
  assert.match(src, /if \(waited >= limit\) \{[^\n]*process\.exit\(4\); \}/);
  assert.match(USAGE, /exit: 0 done, 1 refused, 2 your step \(password, passkey\), 3 the page is hidden or its tree is old, 4 wait timed out/);
});

test("a window fully under other windows of the same Chrome is hidden to Chrome, and nothing is read off or pressed in it", () => {
  const screen = { x: 0, y: 0, width: 1728, height: 1117 }, popup = { x: 0, y: 148, width: 1200, height: 969 };
  // the three lab readings of 2026-11-14: inside the popup the page went hidden; a strip past the screen's left edge did
  // not bring it back; under a smaller popup it stayed live
  assert.equal(covered({ x: 200, y: 154, width: 800, height: 600 }, [popup], screen), true);
  assert.equal(covered({ x: -60, y: 200, width: 800, height: 600 }, [popup], screen), true);
  assert.equal(covered({ x: -60, y: 200, width: 800, height: 600 }, [popup], null), false);   // the strip counts only when the screen is not asked
  assert.equal(covered({ x: 22, y: 55, width: 1200, height: 1040 }, [{ x: 420, y: 52, width: 500, height: 400 }], screen), false);
  assert.equal(covered({ x: 0, y: 33, width: 1728, height: 1084 }, [], screen), false);   // the front window
  // two windows that cover it between them, and two that leave a strip
  assert.equal(covered({ x: 0, y: 0, width: 100, height: 100 }, [{ x: 0, y: 0, width: 60, height: 100 }, { x: 60, y: 0, width: 40, height: 100 }], screen), true);
  assert.equal(covered({ x: 0, y: 0, width: 100, height: 100 }, [{ x: 0, y: 0, width: 60, height: 100 }, { x: 61, y: 0, width: 39, height: 100 }], screen), false);
  assert.equal(covered({ x: 3000, y: 0, width: 800, height: 600 }, [], screen), false);   // on another display: asked whole
  assert.match(src, /if \(hidden === "covered" && acts\) \{ console\.log\(COVERED\(t\.window_id\)\); process\.exit\(3\); \}/);
  assert.match(src, /function hiddenOf\(t\) \{\n  if \(t\.flag\) return null;/);   // with the flag Chrome hides no covered page (measured)
  assert.match(src, /filter\(\(w\) => w\.pid === t\.pid\)/);   // only the same Chrome's windows: behind another app the page stayed live
  assert.equal(FLAG, "--disable-backgrounding-occluded-windows");
});

test("a window is one session's: a second session is refused it until the first lets go, and one command acts at a time", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "chrome-control-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const one = { session: "default", cwd: "/a" }, two = { session: "agent-2", cwd: "/a" };
  assert.equal(claim(dir, "4242-7", one), null);
  assert.equal(claim(dir, "4242-7", one), null);   // mine already
  assert.deepEqual(claim(dir, "4242-7", two), one);
  assert.deepEqual(claim(dir, "4242-7", { session: "default", cwd: "/b" }), one);   // the same name in another project is another session
  assert.equal(claim(dir, "4242-8", two), null);   // another window is free
  assert.equal(claim(dir, "4242-7", two, true), null);   // --take
  assert.deepEqual(claim(dir, "4242-7", one), two);
  const free = lock(dir, 4242, 0);
  assert.equal(typeof free, "function");
  assert.equal(lock(dir, 4242, 0), null);   // held by a live process (this one): not taken
  free();
  const again = lock(dir, 4242, 0);
  assert.equal(typeof again, "function");
  writeFileSync(path.join(dir, "4242.lock", "pid"), "999999999");   // a holder that is gone
  assert.equal(typeof lock(dir, 4242, 0), "function");
  assert.match(src, /const free = lock\(CLAIMS, t\.pid\);\n    if \(!free\) \{[^\n]*process\.exit\(1\); \}\n    process\.on\("exit", free\);/);
  assert.match(src, /if \(other && \(other\.session !== session \|\| other\.cwd !== me\.cwd\)\) \{[^\n]*process\.exit\(1\); \}/);
  assert.ok(src.includes('const KEPT = session === "default" && !browser ? state : state.replace(/\\.json$/, `${browser && `.browser-${browser}`}${session === "default" ? "" : `.${session}`}.json`);'));   // a kept window is a session's, in one browser
});

test("a background key that cua-driver refuses is said, never sent another way", () => {
  assert.match(src, /if \(r\.effect === "refused" \|\| r\.code\) \{ console\.log\(r\.code === "same_pid_keyboard_ambiguity" \? KEYS\(t\.all\.length\)/);
  assert.doesNotMatch(src, /delivery_mode|foreground/);   // no key is ever sent by fronting the window
});
