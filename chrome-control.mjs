#!/usr/bin/env node
// chrome-control.mjs — drive your own signed-in Chrome window on macOS through cua-driver (Accessibility), behind the app
// you have in front, for few tokens: the page prints as short lines, and an action prints only what it changed.
// Nothing is copied out of the profile and no debugging port is opened. Rules and measurements: README.md, docs/research.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

export const FLAG = "--disable-backgrounding-occluded-windows";
const CLAIMS = path.join(tmpdir(), "chrome-control");
const BROWSERS = path.join(process.env.CHROME_CONTROL_HOME || path.join(homedir(), ".chrome-control"), "browsers");   // each a Chrome of the tool's own, on an empty profile you sign in to
export const USAGE = `chrome-control <command> [--session <name>] [--browser <name>]
  windows                      the profile's windows: id, title, who keeps it
  use <id> [--take]            keep that window for this session; release gives it back
  read [lines] [--ui] [--raw]  the page as short lines (60); --ui: toolbar, tabs, extension buttons; --raw: the full tree
  find "<text>"                the lines that hold the text
  wait "<text>" [seconds]      poll until the page holds the text (20 s; exit 4 when it does not)
  press "<label>" [role] ["<row text>"]   press the one element of that label (role: button, link, ...)
  fill "<label>" <text> [role] set a field's value (fires input and change)
  type "<label>" <text> [role] type with real key events; key <name> ["<label>"] presses return, tab, escape, cmd+a ...
  click <x> <y>                click a pixel of the window's capture
  open <url>                   open in a new tab; in the background when Chrome has one window
  close-tab "<title>"          close the one tab of that title
  key-to-env <NAME> '<regex>'  write the one matching text on the page into .env, unprinted
  launch <name> [url]          start a Chrome of the tool's own in the background, on an empty profile; --browser <name> works in it
  doctor                       what works right now, and why not
  stop                         stop cua-driver
exit: 0 done, 1 refused, 2 your step (password, passkey), 3 the page is hidden or its tree is old, 4 wait timed out`;
const SECRET_FIELD = /password|passcode|\bpin\b|one-time|verification code|2-step/i;
export const OWNER_STEP = /enter your password|complete sign-in using your passkey|touch id|verify it.s you|2-step verification/i;

/** Whether a window's accessibility title is the profile's. Chrome ends it "- Google Chrome - <who>": the signed-in
 *  name with the profile's name in brackets ("Sam (Work)", measured), or the profile's name alone. With one profile,
 *  Chrome may name no one (`only`). */
export function ofProfile(title = "", profileName, only = false) {
  const i = title.lastIndexOf(" - Google Chrome - ");
  if (i < 0) return only && title.endsWith(" - Google Chrome");
  const who = title.slice(i + " - Google Chrome - ".length);
  return who === profileName || who.endsWith(`(${profileName})`);
}

/** The profile's one window; null when it has none or several. */
export function windowOf(windows, profileName, only = false) {
  const hits = windows.filter((w) => ofProfile(w.title, profileName, only));
  return hits.length === 1 ? hits[0] : null;
}

/** The profile folder and display name to work in: the folder named, or the only profile Chrome has (Local State's
 *  profile.info_cache). Null when the folder is not Chrome's, or none is named and Chrome has several. */
export function profileOf(infoCache = {}, dir = "") {
  const dirs = Object.keys(infoCache), d = dir || (dirs.length === 1 ? dirs[0] : "");
  return infoCache[d] ? { dir: d, name: infoCache[d].name, only: dirs.length === 1 } : null;
}

/** The owner's own Chrome among the running ones: an automation Chrome (Playwright, Puppeteer, an agent's browser)
 *  runs with its own --user-data-dir. Null when none or several. */
export function ownChrome(procs) {
  const own = procs.filter((p) => !/--user-data-dir/.test(p.args));
  return own.length === 1 ? own[0].pid : null;
}

/** The page title in a Chrome window's accessibility title ("<page> - Google Chrome - <person> (<profile>)"). */
export const pageOf = (windowTitle) => { const i = windowTitle.lastIndexOf(" - Google Chrome"); return i < 0 ? windowTitle : windowTitle.slice(0, i); };

/** The tab's title and the page title the tree holds, when the two disagree: Chrome treats a page as hidden while its
 *  window sits fully under another window of the same Chrome, and stops updating its tree, while the tab's title goes on
 *  changing (measured, docs/research/background-2026-11-14.md). Null when they agree or either has no title. */
export const stillStale = (first, second) => (first && second && first.page === second.page ? second : null);   // a page whose title ticks is read between two ticks: old only when a second read holds the same page

export function staleOf(markdown) {
  const L = markdown.split("\n"), tab = pageOf(/AXWindow "([^"]*)"/.exec(L[0] ?? "")?.[1] ?? "");
  const page = /AXWebArea "([^"]+)"/.exec(L.find((l) => l.includes("AXWebArea")) ?? "")?.[1];
  return tab && page && !tab.startsWith(page) && !page.startsWith(tab) ? { tab, page } : null;
}

// `open`, by Apple Events to that pid (Scripting Bridge), so it reaches neither the automation Chrome nor another
// window: `id` names the one window whose page is that title; `go` sets the address of that window's active tab, only
// while it is a new tab (the tool presses the window's own New Tab button in between). A tab cannot be made by the
// bridge itself: JavaScript for Automation has no initWithProperties on Chrome's tab class.
/** Chrome's window name over Apple Events elides a long title with "…" (2026-11-14: "sam.k…mple.com's Account");
 *  the name matches a full title when its pieces are the title's opening, its ending and in order between. */
export function sameTitle(name, full) {
  if (name === full) return true;
  const parts = name.split("\u2026");
  if (parts.length < 2 || !full.startsWith(parts[0]) || !full.endsWith(parts[parts.length - 1])) return false;
  let at = parts[0].length;
  for (const p of parts.slice(1, -1)) { const j = full.indexOf(p, at); if (j < 0) return false; at = j + p.length; }
  return at <= full.length - parts[parts.length - 1].length;
}

const OPEN = `ObjC.import("ScriptingBridge");
${sameTitle.toString()}
function run([mode, pid, key, url]) {
  const app = $.SBApplication.applicationWithProcessIdentifier(Number(pid)), ws = app.valueForKey("windows"), hits = [];
  for (let i = 0; i < ws.count; i++) {
    const w = ws.objectAtIndex(i);
    if (mode === "id" ? sameTitle(String(ObjC.unwrap(w.valueForKey("name"))), key) : String(ObjC.unwrap(w.valueForKey("id"))) === key) hits.push(w);
  }
  if (hits.length !== 1) return "windows that match: " + hits.length + "; nothing opened";
  if (mode === "id") return String(ObjC.unwrap(hits[0].valueForKey("id")));
  const tab = hits[0].valueForKey("activeTab");
  if (!String(ObjC.unwrap(tab.valueForKey("URL"))).startsWith("chrome://newtab")) return "the active tab is not a new tab; nothing opened";
  tab.setValueForKey($(url), "URL");
  return "opened";
}`;
const appleEvent = (...args) => execFileSync("osascript", ["-l", "JavaScript", "-e", OPEN, ...args.map(String)], { encoding: "utf8" }).trim();

/** The kept window when it is still open and still the profile's; otherwise the one-window rule. */
export function keptWindow(windows, kept, profileName, only = false) {
  const w = kept && windows.find((x) => x.window_id === kept.window_id && ofProfile(x.title, profileName, only));
  return w ?? windowOf(windows, profileName, only);
}

/** The index of the element whose quoted label is exactly `label` (of that role, when given: the window's tree also
 *  holds Chrome's menu bar, whose "New Tab" items are not the tab strip's button); null when none or several. The role is
 *  taken as printed or as the tree has it ("button", "AXButton"), and a label that ends "…" is a label's opening. */
export function elementOf(markdown, label, role = "") {
  const want = role.replace(/^AX/i, "").toLowerCase(), cut = label.endsWith("\u2026") ? label.slice(0, -1) : null;
  const hits = withoutColumns(markdown).filter((l) => {
    const m = /\[\d+\] AX(\w+)(.*)$/.exec(l);
    if (!m || (want && m[1].toLowerCase() !== want)) return false;
    if (cut !== null) return m[2].startsWith(` "${cut}`) || (want !== "" && m[2].startsWith(` = "${cut}`));
    return want ? m[2].startsWith(` "${label}"`) || m[2].startsWith(` = "${label}"`) : l.includes(`"${label}"`);   // a combo box may show only its value
  });
  const one = hits.length === 1 ? hits : hits.filter((l) => /actions=\[[^\]]*press/.test(l));   // a list option repeats its text in a child that cannot be pressed
  return one.length === 1 ? Number(/\[(\d+)\]/.exec(one[0])[1]) : null;
}

/** The address bar's own suggestion that is exactly the address typed: Chrome lists it as "<address>, 1 of 2", and a
 *  bare origin without its last slash. Null when none or several, so nothing else the bar offers is ever pressed. */
export function suggestionOf(markdown, url) {
  const hits = markdown.split("\n").filter((l) => { const m = /\[\d+\] AXStaticText = "(.*), \d+ of \d+"/.exec(l); return m && (m[1] === url || m[1] === url.replace(/\/$/, "")) && /actions=\[[^\]]*press/.test(l); });
  return hits.length === 1 ? Number(/\[(\d+)\]/.exec(hits[0])[1]) : null;
}

/** The tree's lines without a table's column copy: Chrome exposes each cell once under its AXRow and again under an
 *  AXColumn, so a field in a table (WordPress's settings tables) would otherwise be found twice and never pressed. */
export function withoutColumns(markdown) {
  const out = [];
  let skip = -1;
  for (const l of markdown.split("\n")) {
    const d = l.search(/\S/);
    if (skip >= 0 && d > skip) continue;
    skip = /\] AXColumn\b/.test(l) ? d : -1;
    if (skip < 0) out.push(l);
  }
  return out;
}

/** The table row (an AXRow and the lines indented under it) that holds the quoted text `text`, as tree lines; null when
 *  no row or several hold it. A table is also exposed by column, so the text's line under an AXColumn is not a row. */
export function rowOf(markdown, text) {
  const L = markdown.split("\n"), depth = (l) => l.search(/\S/), rows = [];
  L.forEach((l, i) => { if (/\] AXRow\b/.test(l)) { let j = i + 1; while (j < L.length && depth(L[j]) > depth(l)) j++; rows.push(L.slice(i, j)); } });
  const hits = rows.filter((r) => r.some((l) => l.includes(`"${text}"`)));
  return hits.length === 1 ? hits[0].join("\n") : null;
}

/** The tab strip's entry for a page title (Chrome labels a tab "<title> - Memory usage …" or "<title> - Inactive
 *  tab …"); null when none or several, so a tab is closed only by a title that is on one tab. */
export function tabOf(markdown, title) {
  const hits = markdown.split("\n").filter((l) => [" - Memory usage", " - Inactive tab"].some((s) => l.includes(`AXRadioButton "${title}${s}`)));
  return hits.length === 1 ? Number(/\[(\d+)\]/.exec(hits[0])[1]) : null;
}

/** The one quoted text on the page that matches `re` whole; a page with none or several gives null. */
export function onlyMatch(markdown, re) {
  const found = new Set([...markdown.matchAll(/= "([^"]*)"/g)].map((m) => m[1].trim()).filter((t) => new RegExp(`^(?:${re})$`).test(t)));
  return found.size === 1 ? [...found][0] : null;
}

/** .env text with NAME set to value, every other line kept. */
export function withEnv(text, name, value) {
  // A value with spaces (a WordPress application password) breaks `. .env` unquoted; single quotes keep it literal.
  const v = /^[\w.\/:@+-]*$/.test(value) ? value : value.includes("'") ? JSON.stringify(value) : `'${value}'`;
  return [...text.split("\n").filter((l) => l && !l.startsWith(`${name}=`)), `${name}=${v}`].join("\n") + "\n";
}

/** The tree with a label that spans lines put on one line (an extension's toolbar button names itself on two). */
export const oneLine = (markdown) => markdown.split("\n").reduce((out, l) => { if (/^\s*- /.test(l) || !out.length) out.push(l); else out[out.length - 1] += ` ${l.trim()}`; return out; }, []).join("\n");

const PLAIN = /^(Group|Cell|List|Unknown|Splitter|ScrollArea|GenericElement|Section|LayoutItem|LayoutArea)$/;

/** The page as an agent reads it, at a fraction of the tokens (or, with `ui`, the browser's own toolbar, tab strip and
 *  extension buttons): one space a level, roles without "AX", no index, no action list, no description that repeats
 *  the label, no text line that repeats its parent's label or names the field after it, no unnamed group, and a table
 *  by row only (the tree repeats it by column). A line is cut at 160 characters with "…", which `press` takes as a label's opening. */
export function compact(markdown, ui = false) {
  const L = markdown.split("\n"), depth = (l) => l.search(/\S/), web = L.findIndex((l) => /- (\[\d+\] )?AXWebArea/.test(l));
  let end = web + 1;
  while (web >= 0 && end < L.length && depth(L[end]) > depth(L[web])) end++;
  const lines = ui ? (web < 0 ? L.slice(1) : [...L.slice(1, web), ...L.slice(end)]).filter((l) => !/AXMenu/.test(l)) : web < 0 ? [] : L.slice(web + 1, end);
  const out = [], open = [];   // open: the printed lines a line sits under, as [raw depth, text]
  let skip = -1, label = null;   // label: the text line just printed, which the next element may carry as its own name
  for (const l of lines) {
    const m = /^(\s*)- (?:\[\d+\] )?AX(\w+)(.*)$/.exec(l.replace(/ \[(?:id|help|actions)=.*\]$/, ""));
    if (!m) continue;
    const d = m[1].length;
    if (skip >= 0 && d > skip) continue;
    skip = m[2] === "Column" ? d : -1;
    if (skip >= 0) continue;
    let rest = m[3];
    for (let p = rest.indexOf(" ("); p >= 0; p = rest.indexOf(" (", p + 1)) if (rest.endsWith(")") && rest.startsWith(` "${rest.slice(p + 2, -1)}"`)) { rest = rest.slice(0, p); break; }
    while (open.length && open[open.length - 1][0] >= d) open.pop();
    const said = m[2] === "StaticText";
    if (!rest && (said || PLAIN.test(m[2]))) continue;
    const text = said ? rest.replace(/^ = /, "") : `${m[2].toLowerCase()}${rest}`;
    if (said && open.length && open[open.length - 1][1].includes(text)) continue;
    const line = " ".repeat(open.length) + text;
    if (!said && label !== null && line.startsWith(`${" ".repeat(open.length)}${m[2].toLowerCase()} ${label.trim()}`) && label.search(/\S/) === open.length) out.pop();
    label = said ? line : null;
    out.push(line.length > 160 ? `${line.slice(0, 159)}…` : line);
    open.push([d, text]);
  }
  return out;
}

/** What an action changed: the lines the page has now and had not, and how many it lost. */
export function changed(before, after) {
  const had = new Map();
  for (const l of before) had.set(l.trim(), (had.get(l.trim()) ?? 0) + 1);
  const added = after.filter((l) => { const n = had.get(l.trim()) ?? 0; if (n) had.set(l.trim(), n - 1); return !n; });
  return { added, gone: [...had.values()].reduce((x, y) => x + y, 0) };
}

const outside = (p, c) => {   // the parts of p that c does not cover
  const x1 = Math.max(p.x, c.x), y1 = Math.max(p.y, c.y), x2 = Math.min(p.x + p.width, c.x + c.width), y2 = Math.min(p.y + p.height, c.y + c.height);
  if (x1 >= x2 || y1 >= y2) return [p];
  return [{ x: p.x, y: p.y, width: p.width, height: y1 - p.y }, { x: p.x, y: y2, width: p.width, height: p.y + p.height - y2 }, { x: p.x, y: y1, width: x1 - p.x, height: y2 - y1 }, { x: x2, y: y1, width: p.x + p.width - x2, height: y2 - y1 }].filter((r) => r.width > 0 && r.height > 0);
};

/** Whether a window sits fully under the windows in front of it. Chrome asks this of its own windows and treats the
 *  page of a covered one as hidden (measured: the tree stops within two seconds; a strip that shows on the screen
 *  keeps it live, a strip past the screen's edge does not). */
export function covered(win, inFront, screen) {
  const on = screen && outside(win, screen).length ? { x: Math.max(win.x, screen.x), y: Math.max(win.y, screen.y), width: Math.min(win.x + win.width, screen.x + screen.width) - Math.max(win.x, screen.x), height: Math.min(win.y + win.height, screen.y + screen.height) - Math.max(win.y, screen.y) } : win;
  let left = [on.width > 0 && on.height > 0 ? on : win];   // shortcut: a window on a second display is asked whole, add the displays' frames when that matters
  for (const c of inFront) left = left.flatMap((p) => outside(p, c));
  return left.length === 0;
}

const sleep = (s) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, s * 1000);

/** Keep a window for one session, so two agents never work in one window: null when it is free or already mine,
 *  otherwise the claim that holds it. `take` writes over another session's claim. */
export function claim(dir, key, me, take = false) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${key}.json`);
  try { writeFileSync(file, `${JSON.stringify(me)}\n`, { flag: take ? "w" : "wx" }); return null; } catch (e) { if (e.code !== "EEXIST") throw e; }
  const held = JSON.parse(readFileSync(file, "utf8"));
  return held.session === me.session && held.cwd === me.cwd ? null : held;
}

/** One acting command at a time in one Chrome (a new tab or a key is the process's, not a window's). Waits at most
 *  `wait` seconds, takes over a lock whose holder is gone, and returns the release, or null when it could not get it. */
export function lock(dir, key, wait = 30) {
  mkdirSync(dir, { recursive: true });
  const d = path.join(dir, `${key}.lock`), owner = path.join(d, "pid");
  const alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } };
  for (let t = 0; ; t += 0.2) {
    try { mkdirSync(d); writeFileSync(owner, String(process.pid)); return () => rmSync(d, { recursive: true, force: true }); } catch (e) { if (e.code !== "EEXIST") throw e; }
    const held = existsSync(owner) ? Number(readFileSync(owner, "utf8")) : 0;
    if (held ? !alive(held) : Date.now() - statSync(d).mtimeMs > 60_000) { rmSync(d, { recursive: true, force: true }); continue; }
    if (t >= wait) return null;
    sleep(0.2);
  }
}

function cua(tool, args) {
  try { return JSON.parse(execFileSync("cua-driver", ["call", tool, JSON.stringify(args)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 })); }   // a long admin page's tree passes the default 1 MB
  catch (e) { try { return JSON.parse(e.stdout); } catch { throw e; } }   // a refusal is an answer too
}

function ensureDriver() {
  try { cua("list_windows", { pid: 1 }); } catch { execFileSync("open", ["-n", "-g", "-a", "CuaDriver", "--args", "serve"]); sleep(3); }
}

/** Chrome's windows of the profile; the profile's name is only in the accessibility title. */
function profileWindows(browser) {
  const procs = execFileSync("pgrep", ["-x", "Google Chrome"], { encoding: "utf8" }).trim().split("\n").map((p) => ({ pid: Number(p), args: execFileSync("ps", ["-o", "args=", "-p", p], { encoding: "utf8" }) }));
  if (browser) {   // the tool's own Chrome: every window is its own, so no profile is asked
    const mine = procs.filter((p) => p.args.includes(`--user-data-dir=${path.join(BROWSERS, browser)} `));
    if (mine.length !== 1) throw new Error(`browser "${browser}" is not running: \`launch ${browser}\``);
    const all = (cua("list_windows", { pid: mine[0].pid }).windows ?? []).filter((x) => x.title);
    return { dir: `browser ${browser}`, pid: mine[0].pid, name: "", only: true, all, flag: mine[0].args.includes(FLAG), windows: all.map((x) => ({ window_id: x.window_id, title: `${x.title} - Google Chrome` })) };
  }
  const state = JSON.parse(readFileSync(path.join(homedir(), "Library/Application Support/Google/Chrome/Local State"), "utf8"));
  const p = profileOf(state.profile?.info_cache, process.env.OWNER_CHROME_PROFILE);
  if (!p) throw new Error(process.env.OWNER_CHROME_PROFILE ? `Chrome has no profile folder "${process.env.OWNER_CHROME_PROFILE}"` : "Chrome has several profiles: set OWNER_CHROME_PROFILE to one folder (see README)");
  const { dir, name, only } = p;
  const pid = ownChrome(procs);
  if (!pid) throw new Error("not one Chrome without its own --user-data-dir is running");
  const all = (cua("list_windows", { pid }).windows ?? []).filter((x) => x.title);
  const windows = all.map((x) => ({
    window_id: x.window_id,
    title: (/AXWindow "([^"]*)"/.exec(cua("get_window_state", { pid, window_id: x.window_id, include_screenshot: false, max_elements: 1 }).tree_markdown ?? "") ?? [])[1],
  })).filter((w) => ofProfile(w.title, name, only));
  return { dir, pid, name, only, windows, all, flag: procs.find((x) => x.pid === pid).args.includes(FLAG) };
}

// the front app as "<pid> <name>": two Chromes share a name, so the pid is what tells them apart
const front = () => execFileSync("lsappinfo", ["info", "-only", "pid,name", execFileSync("lsappinfo", ["front"], { encoding: "utf8" }).trim()], { encoding: "utf8" }).replace(/"\w+"=/g, "").replace(/\s+/g, " ").trim();

function snapshot(t) {
  let s;
  for (let waited = 0; ; waited += 2) {   // Chrome builds a page's tree only once it is asked: a new browser's first reads come back empty for some seconds
    s = cua("get_window_state", { pid: t.pid, window_id: t.window_id, include_screenshot: false, max_elements: 4000 });
    s.tree_markdown = oneLine(s.tree_markdown ?? "");
    if (waited >= 8 || compact(s.tree_markdown).length) break;
    sleep(2);
  }
  if (OWNER_STEP.test(s.tree_markdown)) { console.log("The page asks for your password or passkey: that step is yours."); process.exit(2); }
  return s;
}

/** "covered" when the window sits fully under other windows of this Chrome, "off" when it is not on the screen
 *  (minimized, another Space: not measured, so only said), else null. With FLAG Chrome hides no covered page. */
function hiddenOf(t) {
  if (t.flag) return null;
  const mine = t.all.find((w) => w.window_id === t.window_id);
  const order = (cua("get_accessibility_tree", {}).windows ?? []).filter((w) => w.pid === t.pid).map((w) => w.window_id), at = order.indexOf(t.window_id);
  if (!mine?.is_on_screen || at < 0) return "off";
  const inFront = order.slice(0, at).map((id) => t.all.find((w) => w.window_id === id)?.bounds).filter(Boolean), scr = cua("get_screen_size", {});
  return covered(mine.bounds, inFront, scr.width ? { x: 0, y: 0, width: scr.width, height: scr.height } : null) ? "covered" : null;
}

const addressOf = (s) => /AXTextField "Address and search bar" = "([^"]*)"/.exec(s.tree_markdown)?.[1] ?? titleOf(s);   // a window with no toolbar: its title
const titleOf = (s) => pageOf(/AXWindow "([^"]*)"/.exec(s.tree_markdown.split("\n")[0])?.[1] ?? "");
const STALE = ({ tab, page }) => `The tab shows "${tab}" but its tree still holds "${page}": Chrome has not updated the page. Bring the window forward (\`open\` does), then try again.`;
const COVERED = (id, acting = true) => `Window ${id} is fully under another window of this Chrome, so Chrome has paused its page: ${acting ? "a press would land unseen, so nothing was done" : "what follows may be old"}. \`doctor\` has the one-time fix; \`open\` brings the window forward.`;
const OFF = (id) => `Window ${id} is not on the screen (minimized or on another Space): its tree may be old.`;
const KEYS = (n) => `cua-driver refuses a background key while Chrome has ${n} windows: it could land in another one. \`fill\` sets a field without keys, and a page's own button stands in for Return. Keys work when Chrome has one window.`;

function printRaw(s, lines) {   // the tree as cua-driver gives it, for a script that parses it
  const all = s.tree_markdown.split("\n"), from = Math.max(0, all.findIndex((l) => l.includes("AXWebArea")));
  console.log([all[0], ...all.slice(from, from + lines)].map((l) => l.slice(0, 180)).join("\n"));
}

function head(t, s, lines = 25, ui = false) {
  const all = compact(s.tree_markdown, ui);
  console.log(`page: ${titleOf(s)} (window ${t.window_id})`);
  if (all.length) console.log(all.slice(0, lines).join("\n"));
  if (all.length > lines) console.log(`… ${all.length - lines} more lines: \`read ${all.length}\`, or \`find "<text>"\``);
}

/** After an action: only what it changed, or the new page's head when the page is another one. */
function report(t, was, s) {
  if (addressOf(s) !== was.address) return head(t, s);
  const { added, gone } = changed(was.lines, compact(s.tree_markdown));
  console.log(added.length || gone ? `changed: ${added.length} new lines, ${gone} gone` : "no change in the page yet: `wait \"<text>\"` polls for one");
  if (added.length) console.log(added.slice(0, 25).join("\n"));
}

function doctor(kept, browser) {
  const perms = cua("check_permissions", {});
  console.log(`${execFileSync("cua-driver", ["--version"], { encoding: "utf8" }).trim()}: Accessibility ${perms.accessibility ? "on" : "OFF"}, Screen Recording ${perms.screen_recording ? "on" : "OFF"}`);
  const p = profileWindows(browser), n = p.all.length;
  console.log(`Chrome pid ${p.pid}: ${n} window${n === 1 ? "" : "s"}, ${p.windows.length} of ${p.dir}`);
  console.log(p.flag ? `${FLAG}: on. A covered window stays live.` : `${FLAG}: off. A window fully under another Chrome window is hidden to Chrome and refused here. To switch it on, quit Chrome, then: open -a "Google Chrome" --args ${FLAG}`);
  console.log(n === 1 ? "keys: `type`, `key` and a background `open` work (Chrome has one window)." : `keys: cua-driver refuses \`type\` and \`key\` while Chrome has ${n} windows, and \`open\` brings Chrome forward. \`press\` and \`fill\` work.`);
  const w = keptWindow(p.windows, kept, p.name, p.only);
  if (!w) return console.log("no kept window: `windows`, then `use <id>`");
  const t = { ...p, window_id: w.window_id }, hidden = hiddenOf(t), stale = staleOf(snapshot(t).tree_markdown);
  console.log(`kept window ${w.window_id}: ${hidden === "covered" ? "covered by another Chrome window (hidden)" : hidden === "off" ? "not on the screen" : "live"}${stale ? `, tree old ("${stale.page}")` : ""}`);
}

export function main(argv = process.argv.slice(2), { envFile = path.join(process.cwd(), ".env"), state = path.join(process.cwd(), ".local", "chrome-control.json") } = {}) {
  process.on("uncaughtException", (e) => { console.log(e.message.split("\n")[0]); process.exit(1); });   // a refusal is one line, not a stack
  try { process.loadEnvFile(envFile); } catch { /* no .env */ }
  const at = argv.indexOf("--session"), session = (at >= 0 ? argv[at + 1] : process.env.CHROME_CONTROL_SESSION) || "default";
  const bat = argv.indexOf("--browser"), browser = (bat >= 0 ? argv[bat + 1] : process.env.CHROME_CONTROL_BROWSER) || "";
  const flags = new Set(argv.filter((x) => /^--(raw|ui|take)$/.test(x)));
  const [cmd, a, b, c] = argv.filter((x, i) => !flags.has(x) && ![at, bat].some((j) => j >= 0 && (i === j || i === j + 1)));
  if (![session, browser || "x", cmd === "launch" ? a ?? "" : "x"].every((n) => /^[\w.-]{1,40}$/.test(n))) { console.log("a session or browser name is letters, digits, dots and dashes"); process.exit(1); }
  if (!cmd || cmd === "help") { console.log(USAGE); process.exit(0); }
  if (cmd === "stop") { execFileSync("cua-driver", ["stop"], { stdio: "ignore" }); console.log("cua-driver stopped"); process.exit(0); }
  const KEPT = session === "default" && !browser ? state : state.replace(/\.json$/, `${browser && `.browser-${browser}`}${session === "default" ? "" : `.${session}`}.json`);
  const kept = existsSync(KEPT) ? JSON.parse(readFileSync(KEPT, "utf8")) : null, me = { session, cwd: process.cwd() };
  ensureDriver();
  const before = front();
  process.on("exit", () => { const now = front(); if (now !== before) console.log(`The front app changed from ${before} to ${now} during this command; nothing was put back.`); });
  if (cmd === "doctor") { doctor(kept, browser); process.exit(0); }
  if (cmd === "launch") {   // measured seven times of seven: a Chrome started this way, on its own data folder, stays behind the app in front
    const dir = path.join(BROWSERS, a);
    if (execFileSync("ps", ["-axo", "args="], { encoding: "utf8" }).includes(`--user-data-dir=${dir} `)) { console.log(`browser "${a}" is already running`); process.exit(1); }
    mkdirSync(dir, { recursive: true });
    const r = cua("launch_app", { bundle_id: "com.google.Chrome", creates_new_application_instance: true, additional_arguments: [`--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", FLAG, ...(b ? [b] : [])] });
    console.log(r.pid ? `browser "${a}" started in the background (pid ${r.pid}), on its own empty profile: sign in there yourself, once. Use it with --browser ${a}` : `not started: ${r.code ?? JSON.stringify(r).slice(0, 200)}`);
    process.exit(r.pid ? 0 : 1);
  }
  const holder = (pid, id) => { const f = path.join(CLAIMS, `${pid}-${id}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null; };
  if (cmd === "windows" || cmd === "use" || cmd === "release") {
    const p = profileWindows(browser);
    if (cmd === "windows") { p.windows.forEach((w) => { const h = holder(p.pid, w.window_id); console.log(w.window_id, w.title, h ? `[kept by ${h.session}]` : ""); }); process.exit(0); }
    if (kept) { const h = holder(kept.pid, kept.window_id); if (h && h.session === session && h.cwd === me.cwd) rmSync(path.join(CLAIMS, `${kept.pid}-${kept.window_id}.json`), { force: true }); }
    if (cmd === "release") { rmSync(KEPT, { force: true }); console.log(kept ? `released window ${kept.window_id}` : "no kept window"); process.exit(0); }
    if (!p.windows.some((w) => w.window_id === Number(a))) { console.log(`window ${a} is not a window of ${p.dir}; see \`windows\``); process.exit(1); }
    const held = claim(CLAIMS, `${p.pid}-${a}`, me, flags.has("--take"));
    if (held) { console.log(`window ${a} is kept by session ${held.session} (${held.cwd}); \`release\` there, or \`use ${a} --take\``); process.exit(1); }
    mkdirSync(path.dirname(KEPT), { recursive: true });
    writeFileSync(KEPT, `${JSON.stringify({ pid: p.pid, window_id: Number(a) })}\n`);
    console.log(`kept window ${a}`); process.exit(0);
  }
  const p = profileWindows(browser), w = keptWindow(p.windows, kept, p.name, p.only);
  if (!w) throw new Error(`no kept window, and not one single window, of ${p.dir}: run \`windows\`, then \`use <id>\` (the tool never opens a window: that takes the screen)`);
  const t = { ...p, window_id: w.window_id }, other = holder(t.pid, t.window_id);
  if (other && (other.session !== session || other.cwd !== me.cwd)) { console.log(`window ${t.window_id} is kept by session ${other.session} (${other.cwd}); \`windows\`, then \`use <id>\``); process.exit(1); }
  if (["press", "fill", "type", "key", "click", "open", "close-tab"].includes(cmd)) {
    const free = lock(CLAIMS, t.pid);
    if (!free) { console.log("another chrome-control command has been acting in this Chrome for 30 s; nothing done"); process.exit(1); }
    process.on("exit", free);
  }
  let s = snapshot(t), stale = staleOf(s.tree_markdown);
  if (stale) { sleep(1); s = snapshot(t); stale = stillStale(stale, staleOf(s.tree_markdown)); }
  const hidden = cmd === "open" ? null : hiddenOf(t), acts = ["press", "fill", "type", "key", "click", "key-to-env", "wait"].includes(cmd);
  if (hidden === "covered" && acts) { console.log(COVERED(t.window_id)); process.exit(3); }
  if (stale && acts) { console.log(STALE(stale)); process.exit(3); }   // an index or a value read off an old tree is a guess
  const was = { title: titleOf(s), address: addressOf(s), lines: compact(s.tree_markdown) }, here = { pid: t.pid, window_id: t.window_id };
  if (cmd === "open") {   // a new tab, the address set in its bar, then Return. Once the bar lists suggestions, that list is a second window and Return is refused: its row for this very address is pressed. Both stay in the background (measured)
    const tab = elementOf(s.tree_markdown, "New Tab", "AXButton");
    if (tab === null) { console.log("no single New Tab button in the window"); process.exit(1); }
    cua("click", { ...here, element_index: tab, snapshot_id: s.snapshot_id, action: "press" }); sleep(2); s = snapshot(t);
    const bar = elementOf(s.tree_markdown, "Address and search bar", "AXTextField");
    if (bar === null || titleOf(s) !== "New Tab") { console.log("the new tab did not open; nothing opened"); process.exit(1); }
    cua("set_value", { ...here, element_index: bar, snapshot_id: s.snapshot_id, value: a }); sleep(1.5);
    const rows = (cua("list_windows", { pid: t.pid }).windows ?? []).filter((x) => x.is_on_screen && !x.title).flatMap((x) => {   // the suggestions are a window of their own
      const list = cua("get_window_state", { pid: t.pid, window_id: x.window_id, include_screenshot: false, max_elements: 60 });
      const row = /AXWebArea "Omnibox Popup"/.test(list.tree_markdown ?? "") ? suggestionOf(list.tree_markdown, a) : null;
      return row === null ? [] : [{ pid: t.pid, window_id: x.window_id, snapshot_id: list.snapshot_id, element_index: row }];
    });
    let how = "in the background";
    if (rows.length === 1) cua("click", { ...rows[0], action: "press" });
    else if (((r) => r.effect === "refused" || r.code)(cua("press_key", { ...here, element_index: bar, snapshot_id: s.snapshot_id, key: "return" }))) {   // several windows: no list shows and Return is refused. An Apple Event to this Chrome's pid, which brings it forward (3 of 3 by pid)
      const id = appleEvent("id", t.pid, "New Tab"), r = /^\d+$/.test(id) ? appleEvent("go", t.pid, id, a) : id;
      if (r !== "opened") { console.log(`${r} (a new tab was left open)`); process.exit(1); }
      how = "by an Apple Event, which brought Chrome forward";
    }
    sleep(7); s = snapshot(t); console.log(`opened ${how}`); head(t, s); process.exit(0);
  }
  if (cmd === "press" || cmd === "fill" || cmd === "type" || cmd === "key") {
    const label = cmd === "key" ? b : a, role = (cmd === "press" ? b : c) ?? "";
    const scope = cmd === "press" && c ? rowOf(s.tree_markdown, c) : s.tree_markdown;   // press "<label>" <role> "<row text>"
    if (scope === null) { console.log(`no single table row holds "${c}"`); process.exit(1); }
    if ((cmd === "fill" || cmd === "type") && SECRET_FIELD.test(a)) { console.log(`refused: "${a}" is a secret field, your step`); process.exit(2); }
    const idx = label ? elementOf(scope, label, role) : null;   // a key may go to whatever has the focus
    if (label && idx === null) { console.log(`no single element labelled "${label}"${role ? ` of role ${role}` : ""}`); process.exit(1); }
    const el = { ...here, snapshot_id: s.snapshot_id, ...(idx === null ? {} : { element_index: idx }) }, keys = cmd === "key" ? a.toLowerCase().split("+") : [];
    const r = cmd === "press" ? cua("click", { ...el, action: "press" }) : cmd === "fill" ? cua("set_value", { ...el, value: b }) : cmd === "type" ? cua("type_text", { ...el, text: b }) : cua("press_key", { ...el, key: keys.pop(), modifiers: keys });
    if (r.effect === "refused" || r.code) { console.log(r.code === "same_pid_keyboard_ambiguity" ? KEYS(t.all.length) : `refused by cua-driver: ${r.code ?? r.effect}`); process.exit(1); }
    sleep(cmd === "press" ? 4 : 2); s = snapshot(t); report(t, was, s); process.exit(0);
  }
  if (cmd === "click") {
    cua("get_window_state", { ...here, include_accessibility_tree: false });   // pixels are read off this capture
    cua("click", { ...here, x: Number(a), y: Number(b) }); sleep(5); s = snapshot(t); report(t, was, s); process.exit(0);
  }
  if (cmd === "close-tab") {   // only the active tab shows its Close button: make it active, check the window's title, close
    let idx = tabOf(s.tree_markdown, a);
    if (idx === null) { console.log(`no single tab titled "${a}"`); process.exit(1); }
    const lines = () => s.tree_markdown.split("\n"), closeAfter = () => { const L = lines(), i = L.findIndex((l) => l.includes(`[${tabOf(s.tree_markdown, a)}] `)); return /AXButton "Close"/.test(L[i + 1] ?? "") ? Number(/\[(\d+)\]/.exec(L[i + 1])[1]) : null; };
    if (closeAfter() === null) { cua("click", { ...here, element_index: idx, snapshot_id: s.snapshot_id, action: "press" }); sleep(2); s = snapshot(t); }
    if (!(/AXWindow "([^"]*)"/.exec(lines()[0])?.[1] ?? "").startsWith(`${a} - Google Chrome`)) { console.log(`"${a}" did not become the active tab; nothing closed`); process.exit(1); }
    idx = closeAfter();
    if (idx === null) { console.log(`no Close button on "${a}"`); process.exit(1); }
    cua("click", { ...here, element_index: idx, snapshot_id: s.snapshot_id, action: "press" });
    console.log(`closed "${a}"`); process.exit(0);
  }
  if (cmd === "key-to-env") {
    const value = onlyMatch(s.tree_markdown, b);
    if (!value) { console.log(`not exactly one text on the page matches ${b}`); process.exit(1); }
    writeFileSync(envFile, withEnv(existsSync(envFile) ? readFileSync(envFile, "utf8") : "", a, value), { mode: 0o600 });
    console.log(`${a} written to .env (${value.length} characters, not printed)`); process.exit(0);
  }
  const holds = () => [...compact(s.tree_markdown), ...compact(s.tree_markdown, true)].filter((l) => l.toLowerCase().includes(String(a).toLowerCase())).map((l) => l.trim());
  if (cmd === "wait") {   // bounded: 20 s unless told, never past 300
    const limit = Math.min(Number(b) || 20, 300);
    for (let waited = 0; ; waited += 2) {
      const hits = holds();
      if (hits.length) { console.log(hits.slice(0, 5).join("\n")); process.exit(0); }
      if (waited >= limit) { console.log(`"${a}" is not on the page after ${limit} s`); process.exit(4); }
      sleep(2); s = snapshot(t);
    }
  }
  if (hidden) console.log(hidden === "covered" ? COVERED(t.window_id, false) : OFF(t.window_id));
  if (stale) console.log(STALE(stale));
  if (cmd === "find") { const hits = holds(); console.log(hits.length ? hits.slice(0, 20).join("\n") : `nothing on the page holds "${a}"`); process.exit(hits.length ? 0 : 1); }
  if (cmd !== "read") { console.log(`unknown command "${cmd}"\n${USAGE}`); process.exit(1); }
  if (flags.has("--raw")) printRaw(s, Number(a) || 60); else head(t, s, Number(a) || 60, flags.has("--ui"));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
