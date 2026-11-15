# Q: Can the tool copy a signed-in profile into a second browser, so an agent is signed in without a sign-in?

2026-11-14. Short answer: no, not reliably, and not on your real Chrome. The tool does not do this.

## Why people want it

A background agent needs a signed-in browser. A `launch` browser starts empty. So the idea is to copy a profile that is already signed in into the agent's browser. This saves a sign-in.

## What I measured

Same Mac, Chrome 157.0.8103.51, cua-driver 0.24.0. Each run used throwaway `launch` browsers on temp profiles. The lab page `lab/site/state.html` writes a `localStorage` value and a cookie, and puts both in its title. No Google account was used.

The design under test: quit the source browser, delete the target, copy the source user-data-dir into the target with `cpSync`, then launch the target and read the state.

| Run | Source state before quit | Target state after copy |
|---|---|---|
| 1 | `ls=LS-A ck=CK-A` | `ls=LS-A ck=none` (localStorage carried, the cookie did not) |
| 2 | `ls=LS-B ck=CK-B`, quit after 35 s | `ls=none ck=none` (neither carried) |
| 3 | `ls=LS-C ck=CK-C`, quit after 30 s | The source cookie row was on disk (`v10`, encrypted). The target had no readable `Cookies` file at all. |

The result changed from run to run. The cookie, which is the usual sign-in, never carried.

## Why it does not work

- **The owner's real profile signs out.** A copy of the owner's live profile, used in a second browser, made Google and Cloudflare end the session in the owner's own Chrome (measured 2026-11-14, `tasks/learning.md` in the rehabnearme repo). Google binds a session to one browser.
- **Cookies do not transplant.** Chrome encrypts cookie values with a key it holds apart from the profile, and it guards the cookie store against a copy. A copied cookie did not decrypt or did not arrive.
- **A file copy of a live database is not safe.** A profile holds LevelDB and SQLite stores with their own locks and lazy writes. A copy catches them part-written. This is why the result changed each run.

## What to do instead (reliable, in the tool today)

- **Sign in one time, then reuse.** A `launch` browser keeps its profile across runs. Sign in there one time. Every later background run is already signed in. No copy.
- **Many agents, one sign-in each.** Give each agent its own `launch` browser. Sign in to each one time. They persist.
- **Many agents, no extra sign-in.** Point every agent at one `launch` browser, each with its own `--session`. The per-Chrome lock makes them act one at a time. This fits one account's dashboards (Search Console, Bing, Cloudflare).

## Not retried

A cold copy might carry a store that does not use cookies (some sites keep a token in `localStorage` or IndexedDB). It was not reliable here, so the tool does not offer it. If a future need is real and narrow, measure it again against the same page before adding a command.
