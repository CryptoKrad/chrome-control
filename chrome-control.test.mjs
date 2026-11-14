// chrome-control: it finds the profile's own Chrome window, presses an element only by a label that is on the page
// once, never fills a secret field, stops at a password or passkey prompt, writes a key into .env only when exactly one
// text on the page is that key, refuses to act on a tree Chrome has not updated, opens a page only in a new tab of the
// kept window and never puts an app back in front.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { windowOf, keptWindow, elementOf, onlyMatch, withEnv, tabOf, OWNER_STEP, ownChrome, pageOf, sameTitle, rowOf, ofProfile, profileOf, staleOf } from "./chrome-control.mjs";

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
  assert.match(src, /elementOf\(scope, a, cmd === "press" \? b : c \?\? ""\)/);
});

test("a key goes to .env only when exactly one text is the key, and the other lines stay", () => {
  assert.equal(onlyMatch(tree, "[0-9a-f]{32}"), "0123456789abcdef0123456789abcdef");
  assert.equal(onlyMatch(tree + '\n- [50] AXStaticText = "ffffffffffffffffffffffffffffffff"', "[0-9a-f]{32}"), null);
  assert.equal(withEnv("A=1\nEXAMPLE_API_KEY=old\n", "EXAMPLE_API_KEY", "new"), "A=1\nEXAMPLE_API_KEY=new\n");
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
  assert.match(src, /cmd === "fill" && SECRET_FIELD\.test\(a\)/);
  assert.doesNotMatch(src, /Cookies|Login Data|--user-data-dir=/);   // nothing is copied from the profile, and no Chrome is started on a copy
});

test("open reaches only your own Chrome by pid, as a new tab of the kept window; nothing is put back", () => {
  // measured with several Chrome windows open: a launch raised Chrome, and a background Return is refused
  assert.doesNotMatch(src, /"-na"|--new-window|launch_app|bring_to_front|activate|"-a", "Google Chrome"|press_key|"Address and search bar"|application id|Application\("Google Chrome"\)/);
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
  const own = { pid: 812, args: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" };
  const bot = { pid: 4242, args: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/agent-profile --remote-debugging-port=0" };
  assert.equal(ownChrome([own, bot]), 812);
  assert.equal(ownChrome([bot, own]), 812);
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
  assert.match(src, /const stale = \["press", "fill", "click", "key-to-env"\]\.includes\(cmd\) && staleOf\(s\.tree_markdown \?\? ""\);\n  if \(stale\) \{ console\.log\(STALE\(stale\)\); process\.exit\(3\); \}/);
});
