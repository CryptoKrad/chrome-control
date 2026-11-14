#!/usr/bin/env node
// chrome-control.mjs — drive your own Chrome window through cua-driver (macOS Accessibility) without taking the screen:
// read a page, press a link or button by its exact label, set a field, close a tab, and copy one key from a page into
// .env unprinted. It works behind whatever app you have in front, in a window of one Chrome profile: OWNER_CHROME_PROFILE
// in the environment or the .env of the folder you run it from (a profile folder such as "Profile 1"), or the only
// profile Chrome has. Nothing is copied out of the profile.
//
//   node chrome-control.mjs windows             list the profile's windows; `use <window id>` keeps one
//   node chrome-control.mjs open <url>          open the url in a new tab of the kept window, print the page
//   node chrome-control.mjs read [lines]        print the page the kept window shows, as an accessibility tree
//   node chrome-control.mjs press "<label>" [role] ["<row text>"]   press the element of that exact label (in the one table row holding the text; and role, e.g. AXButton)
//   node chrome-control.mjs click <x> <y>       click at screenshot pixels (for images that cannot be pressed)
//   node chrome-control.mjs fill "<label>" <text> [role]   set a field's value; never a password field
//   node chrome-control.mjs key-to-env <NAME> <regex>   write the one text on the page that matches into .env, unprinted
//   node chrome-control.mjs close-tab "<page title>"   close the one tab of that title
//   node chrome-control.mjs stop               stop cua-driver
// A page that asks for a password or a passkey ends the command with exit 2: that step is yours. A tree Chrome has not
// updated (the tab's title and the page's differ) ends press, fill, click and key-to-env with exit 3.
// It never puts an app back in front. Every command works in the kept window by accessibility, in the background, except
// `open`. Measured on macOS with several Chrome windows open: a Chrome launch raised Chrome, and a background Return is
// refused (it could land in another window). So `open` presses the window's own New Tab button, then sets that tab's
// address by an Apple Event to your Chrome's pid, which brings Chrome forward. When the front app changes during a
// command it says so, and leaves it.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const ENV = path.join(process.cwd(), ".env");
const KEPT = path.join(process.cwd(), ".local", "chrome-control.json");
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

/** The tab's title and the page title the tree holds, when the two disagree: Chrome can stop updating the tree of a page
 *  whose window another app covers, while the tab's title goes on changing (measured: with an editor in front, a tab
 *  read "URL Inspection" for minutes while its tree kept the page before; with Chrome in front it caught up within
 *  seconds). Null when they agree or either has no title. */
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
 *  holds Chrome's menu bar, whose "New Tab" items are not the tab strip's button); null when none or several. */
export function elementOf(markdown, label, role = "") {
  const hits = markdown.split("\n").filter((l) => (l.includes(`${role}${role && " "}"${label}"`) || (role && l.includes(`${role} = "${label}"`))) && /\[(\d+)\]/.test(l));   // a combo box may show only its value
  const one = hits.length === 1 ? hits : hits.filter((l) => /actions=\[[^\]]*press/.test(l));   // a list option repeats its text in a child that cannot be pressed
  return one.length === 1 ? Number(/\[(\d+)\]/.exec(one[0])[1]) : null;
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
  return [...text.split("\n").filter((l) => l && !l.startsWith(`${name}=`)), `${name}=${value}`].join("\n") + "\n";
}

const cua = (tool, args) => JSON.parse(execFileSync("cua-driver", ["call", tool, JSON.stringify(args)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
const sleep = (s) => execFileSync("sleep", [String(s)]);

function ensureDriver() {
  try { cua("list_windows", { pid: 1 }); } catch { execFileSync("open", ["-n", "-g", "-a", "CuaDriver", "--args", "serve"]); sleep(3); }
}

/** Chrome's windows of the profile; the profile's name is only in the accessibility title. */
function profileWindows() {
  const state = JSON.parse(readFileSync(path.join(homedir(), "Library/Application Support/Google/Chrome/Local State"), "utf8"));
  const p = profileOf(state.profile?.info_cache, process.env.OWNER_CHROME_PROFILE);
  if (!p) throw new Error(process.env.OWNER_CHROME_PROFILE ? `Chrome has no profile folder "${process.env.OWNER_CHROME_PROFILE}"` : "Chrome has several profiles: set OWNER_CHROME_PROFILE to one folder (see README)");
  const { dir, name, only } = p;
  const pid = ownChrome(execFileSync("pgrep", ["-x", "Google Chrome"], { encoding: "utf8" }).trim().split("\n").map((p) => ({ pid: Number(p), args: execFileSync("ps", ["-o", "args=", "-p", p], { encoding: "utf8" }) })));
  if (!pid) throw new Error("not one Chrome without its own --user-data-dir is running");
  const windows = (cua("list_windows", { pid }).windows ?? []).filter((x) => x.title).map((x) => ({
    window_id: x.window_id,
    title: (/AXWindow "([^"]*)"/.exec(cua("get_window_state", { pid, window_id: x.window_id, include_screenshot: false, max_elements: 1 }).tree_markdown ?? "") ?? [])[1],
  })).filter((w) => ofProfile(w.title, name, only));
  return { dir, pid, name, only, windows };
}

function target() {
  const p = profileWindows();
  const w = keptWindow(p.windows, existsSync(KEPT) ? JSON.parse(readFileSync(KEPT, "utf8")) : null, p.name, p.only);
  if (!w) throw new Error(`no kept window, and not one single window, of ${p.dir}: run \`windows\`, then \`use <id>\` (the tool never opens a window: that takes the screen)`);
  return { ...p, window_id: w.window_id };
}

const front = () => execFileSync("lsappinfo", ["info", "-only", "name", execFileSync("lsappinfo", ["front"], { encoding: "utf8" }).trim()], { encoding: "utf8" }).replace(/.*=/, "").trim();

function snapshot(t) {
  const s = cua("get_window_state", { pid: t.pid, window_id: t.window_id, include_screenshot: false, max_elements: 4000 });
  if (OWNER_STEP.test(s.tree_markdown ?? "")) { console.log("The page asks for your password or passkey: that step is yours."); process.exit(2); }
  return s;
}

const STALE = ({ tab, page }) => `The tab shows "${tab}" but its tree still holds "${page}": Chrome has not updated the page, which happens while another app covers the window. Bring Chrome forward (\`open\` does), then try again.`;

function print(s, lines = 60) {
  const stale = staleOf(s.tree_markdown ?? "");
  if (stale) console.log(STALE(stale));
  const all = (s.tree_markdown ?? "").split("\n");
  const from = Math.max(0, all.findIndex((l) => l.includes("AXWebArea")));
  console.log([all[0], ...all.slice(from, from + lines)].map((l) => l.slice(0, 180)).join("\n"));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.on("uncaughtException", (e) => { console.log(e.message.split("\n")[0]); process.exit(1); });   // a refusal is one line, not a stack
  try { process.loadEnvFile(ENV); } catch { /* no .env */ }
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === "stop") { execFileSync("cua-driver", ["stop"], { stdio: "ignore" }); console.log("cua-driver stopped"); process.exit(0); }
  ensureDriver();
  const before = front();
  process.on("exit", () => { const now = front(); if (now !== before) console.log(`The front app changed from ${before} to ${now} during this command; nothing was put back.`); });
  if (cmd === "windows" || cmd === "use") {
    const p = profileWindows();
    if (cmd === "windows") { p.windows.forEach((w) => console.log(w.window_id, w.title)); process.exit(0); }
    if (!p.windows.some((w) => w.window_id === Number(a))) { console.log(`window ${a} is not a window of ${p.dir}; see \`windows\``); process.exit(1); }
    mkdirSync(path.dirname(KEPT), { recursive: true });
    writeFileSync(KEPT, JSON.stringify({ pid: p.pid, window_id: Number(a) }) + "\n");
    console.log(`kept window ${a}`); process.exit(0);
  }
  const t = target();
  let s = snapshot(t);
  const stale = ["press", "fill", "click", "key-to-env"].includes(cmd) && staleOf(s.tree_markdown ?? "");
  if (stale) { console.log(STALE(stale)); process.exit(3); }   // an index or a value read off an old tree is a guess
  if (cmd === "open") {   // may bring Chrome forward; nothing is put back
    const id = appleEvent("id", t.pid, pageOf(/AXWindow "([^"]*)"/.exec(s.tree_markdown.split("\n")[0])?.[1] ?? ""));
    if (!/^\d+$/.test(id)) { console.log(id); process.exit(1); }
    const tab = elementOf(s.tree_markdown, "New Tab", "AXButton");
    if (tab === null) { console.log("no single New Tab button in the window"); process.exit(1); }
    cua("click", { pid: t.pid, window_id: t.window_id, element_index: tab, snapshot_id: s.snapshot_id, action: "press" }); sleep(2);
    const r = appleEvent("go", t.pid, id, a);
    if (r !== "opened") { console.log(r); process.exit(1); }
    sleep(7); s = snapshot(t);
  }
  if (cmd === "press" || cmd === "fill") {
    const scope = cmd === "press" && c ? rowOf(s.tree_markdown, c) : s.tree_markdown;   // press "<label>" <role> "<row text>"
    if (scope === null) { console.log(`no single table row holds "${c}"`); process.exit(1); }
    const idx = elementOf(scope, a, cmd === "press" ? b : c ?? "");   // fill takes its role after the text
    if (idx === null) { console.log(`no single element labelled "${a}"${cmd === "press" && b ? ` of role ${b}` : ""}`); process.exit(1); }
    if (cmd === "fill" && SECRET_FIELD.test(a)) { console.log(`refused: "${a}" is a secret field, your step`); process.exit(2); }
    if (cmd === "press") cua("click", { pid: t.pid, window_id: t.window_id, element_index: idx, snapshot_id: s.snapshot_id, action: "press" });
    else cua("set_value", { pid: t.pid, window_id: t.window_id, element_index: idx, snapshot_id: s.snapshot_id, value: b });
    sleep(4); s = snapshot(t);
  }
  if (cmd === "click") {
    cua("get_window_state", { pid: t.pid, window_id: t.window_id, include_accessibility_tree: false });   // pixels are read off this capture
    cua("click", { pid: t.pid, window_id: t.window_id, x: Number(a), y: Number(b) }); sleep(5); s = snapshot(t);
  }
  if (cmd === "close-tab") {   // only the active tab shows its Close button: make it active, check the window's title, close
    let idx = tabOf(s.tree_markdown, a);
    if (idx === null) { console.log(`no single tab titled "${a}"`); process.exit(1); }
    const lines = () => s.tree_markdown.split("\n"), closeAfter = () => { const L = lines(), i = L.findIndex((l) => l.includes(`[${tabOf(s.tree_markdown, a)}] `)); return /AXButton "Close"/.test(L[i + 1] ?? "") ? Number(/\[(\d+)\]/.exec(L[i + 1])[1]) : null; };
    if (closeAfter() === null) { cua("click", { pid: t.pid, window_id: t.window_id, element_index: idx, snapshot_id: s.snapshot_id, action: "press" }); sleep(2); s = snapshot(t); }
    if (!(/AXWindow "([^"]*)"/.exec(lines()[0])?.[1] ?? "").startsWith(`${a} - Google Chrome`)) { console.log(`"${a}" did not become the active tab; nothing closed`); process.exit(1); }
    idx = closeAfter();
    if (idx === null) { console.log(`no Close button on "${a}"`); process.exit(1); }
    cua("click", { pid: t.pid, window_id: t.window_id, element_index: idx, snapshot_id: s.snapshot_id, action: "press" });
    console.log(`closed "${a}"`); process.exit(0);
  }
  if (cmd === "key-to-env") {
    const value = onlyMatch(s.tree_markdown, b);
    if (!value) { console.log(`not exactly one text on the page matches ${b}`); process.exit(1); }
    writeFileSync(ENV, withEnv(existsSync(ENV) ? readFileSync(ENV, "utf8") : "", a, value), { mode: 0o600 });
    console.log(`${a} written to .env (${value.length} characters, not printed)`); process.exit(0);
  }
  print(s, cmd === "read" && a ? Number(a) : 60);
}
