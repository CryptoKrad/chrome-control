# lab

What the measurements in [docs/research/background-2026-11-14.md](../docs/research/background-2026-11-14.md) were made with. Everything here runs in a throwaway Chrome on an empty temp profile, never in your own.

| File | What it is |
|---|---|
| `site/` | The lab page. It writes its own state into its title every second: `visibilityState`, a timer, the last input events, the field values. So the title is the page's truth, and the tree can be checked against it. |
| `launch.mjs <name> [chrome flags]` | Starts a lab Chrome behind the front app and prints its pid and temp profile. |
| `lab.mjs <pid> state` | Prints each window's title beside what its tree says, the front app and the window order. |
| `step.mjs <pid> <steps>` | Runs presses, values, keys and window moves, and prints the state after each. The step forms are in its first line. |
| `e2e.mjs` | Every command of the tool, end to end, in a browser of its own. Checks the front app never changed, then deletes the profile. |
| `proofs.py` | Takes each guard out of `chrome-control.mjs` in turn. `node --test` must fail every time. |

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory lab/site &   # launch.mjs opens this address
node lab/launch.mjs a                                    # case 1: note the front app before and after
node lab/lab.mjs <pid> state                             # cases 4 to 7: title against tree
node lab/step.mjs <pid> 'press|lab|AXButton|Sync view' 'wait|2' show
node lab/launch.mjs b --disable-backgrounding-occluded-windows   # case 7
node lab/e2e.mjs                                         # serves the page itself, on 8799
python3 lab/proofs.py                                    # run with a clean tree
```

When you are done, quit each lab Chrome and delete the temp profile `launch.mjs` printed.
