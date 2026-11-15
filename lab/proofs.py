#!/usr/bin/env python3
"""Removal proofs: each guard of chrome-control.mjs is taken out in turn and `node --test` must fail.
Run from the repo root with a clean tree: python3 lab/proofs.py (the source is put back after every proof)."""
import subprocess, sys

PATH = "chrome-control.mjs"
src = open(PATH).read()
MUTATIONS = [
    ("covered: a strip left over still counts as covered", "return left.length === 0;", "return left.length <= 1;"),
    ("covered: the screen's edge is not asked", "const on = screen && outside(win, screen).length ?", "const on = false && outside(win, screen).length ?"),
    ("claim: a second session may write over it", '{ flag: take ? "w" : "wx" }', '{ flag: "w" }'),
    ("claim: another project's default session is the same", "held.session === me.session && held.cwd === me.cwd ? null : held", "held.session === me.session ? null : held"),
    ("lock: a live holder's lock is taken", "if (held ? !alive(held) :", "if (held ? true :"),
    ("lock: a dead holder's lock is kept", "if (held ? !alive(held) :", "if (held ? false :"),
    ("stale: one read is enough", "first && second && first.page === second.page ? second : null", "first && second ? second : null"),
    ("stale: a tab and a page that differ are not told", "return tab && page && !tab.startsWith(page) && !page.startsWith(tab) ? { tab, page } : null;", "return null;"),
    ("compact: the column copy is printed", 'skip = m[2] === "Column" ? d : -1;', "skip = -1;"),
    ("compact: an empty text prints a line", "if (!rest && (said || PLAIN.test(m[2]))) continue;", "if (!rest && PLAIN.test(m[2])) continue;"),
    ("compact: a label's text stays before its field", "=== open.length) out.pop();", "=== open.length) out.length;"),
    ("compact: the browser's menus are printed", ".filter((l) => !/AXMenu/.test(l)) : web < 0", " : web < 0"),
    ("elementOf: the role is asked as typed", "m[1].toLowerCase() !== want", 'm[1] !== role.replace(/^AX/, "")'),
    ("elementOf: a cut label matches nothing", "if (cut !== null) return", "if (cut === undefined) return"),
    ("elementOf: a label on several lines is pressed", "return one.length === 1 ? Number(", "return one.length >= 1 ? Number("),
    ("oneLine: a two-line label stays on two lines", "else out[out.length - 1] += ` ${l.trim()}`;", "else out.push(l);"),
    ("changed: a line twice counts once", "if (n) had.set(l.trim(), n - 1); return !n;", "return !n;"),
    ("a covered window is acted in", 'if (hidden === "covered" && acts) {', 'if (false && acts) {'),
    ("the flag is not asked", "if (t.flag) return null;", ""),
    ("a secret field is typed into", '(cmd === "fill" || cmd === "type") && SECRET_FIELD.test(a)', 'cmd === "fill" && SECRET_FIELD.test(a)'),
    ("open: a suggestion that is not the address is pressed", 'return m && (m[1] === url || m[1] === url.replace(/\\/$/, "")) && /actions', "return m && /actions"),
    ("open: of several suggestions one is pressed", "return hits.length === 1 ? Number(/\\[(\\d+)\\]/.exec(hits[0])[1]) : null;\n}\n\n/** The table row", "return hits.length >= 1 ? Number(/\\[(\\d+)\\]/.exec(hits[0])[1]) : null;\n}\n\n/** The table row"),
    ("open: a window that is not the suggestions' is pressed in", 'const row = /AXWebArea "Omnibox Popup"/.test(list.tree_markdown ?? "") ? suggestionOf', 'const row = true ? suggestionOf'),
    ("wait has no bound", "Math.min(Number(b) || 20, 300)", "Number(b) || 20"),
    ("another session's window is used", "if (other && (other.session !== session || other.cwd !== me.cwd)) {", "if (false) {"),
    ("two commands act at once", "const free = lock(CLAIMS, t.pid);", "const free = () => {};"),
    ("your own Chrome may be one with its own data folder", "const own = procs.filter((p) => !/--user-data-dir/.test(p.args));", "const own = procs;"),
]
if subprocess.run(["node", "--test"], capture_output=True).returncode != 0:
    sys.exit("the tests fail before any guard is removed: fix that first")
missed = 0
try:
    for name, old, new in MUTATIONS:
        if src.count(old) != 1:
            print("NOT ONE:", name); missed += 1; continue
        open(PATH, "w").write(src.replace(old, new))
        caught = subprocess.run(["node", "--test"], capture_output=True).returncode != 0
        print(("caught  " if caught else "MISSED  ") + name)
        missed += not caught
finally:
    open(PATH, "w").write(src)
print(f"{len(MUTATIONS)} proofs, {missed} missed")
sys.exit(1 if missed else 0)
