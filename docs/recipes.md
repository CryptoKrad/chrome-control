# Recipes

Steps that worked, in order, for jobs done with chrome-control in someone's own Chrome. Each one says what was measured and when. `cc` stands for `node /path/to/chrome-control/chrome-control.mjs`.

## Start in the right window

1. `cc profiles`. Find the line whose account holds the sign-in you need (a dashboard, an analytics account). Put its folder in `.env` as `OWNER_CHROME_PROFILE="Profile N"` in the folder you run the tool from.
2. `cc doctor`. It must say Accessibility and Screen Recording are on. With several windows it says `type` and `key` are refused; `press`, `fill`, `click` and `open` still work.
3. `cc windows`, then `cc use <id>` on a window of that profile. Prefer a window that already shows the service you need: it is signed in.

## One tab per agent, in a shared window (measured 2026-11-18)

1. `export CHROME_CONTROL_SESSION=<agent name>`, also in any wrapper script.
2. `cc windows`, then `cc tab <id> <url>`. `windows` shows each window's kept tabs.
3. Work as usual: `read`, `find`, `wait`, `press`, `fill` act in your tab, whichever tab the window shows between commands. `open <url>` loads your tab; on a page other than the new tab page it may bring Chrome forward, so prefer following a link.
4. A tab Chrome has unloaded answers with exit 3: `cc press Reload button`.
5. `cc close-tab` closes your tab and no other. `cc release` lets go and leaves it open.

## Open a page

- `cc open <url>`. With several Chrome windows Return is refused, so `open` puts the address in the new tab page's own search box and presses that box's suggestion for exactly the address (measured 2026-11-17, 10 windows, in the background). Only when no search box is found does it use an Apple Event, which brings Chrome forward.
- To go to an address in a tab that already shows the new tab page: `cc fill "<search box label>" <url> textarea` (the label was "Ask Google" in 2026), then `cc press "<url>, 1 of N"` with the exact line `fill` printed. An address from history prints as `<url>, press Tab then Enter to Remove Suggestion., 1 of N`; press that line as printed.
- To switch tabs: `cc read --ui` lists them as `radiobutton "<title> - Memory usage - N MB"`; `cc press "<that text>" radiobutton`.

## Controls with no usable label

- **A dropdown's options are plain text.** Open the dropdown with `cc press "<its label>" combobox` (or `popupbutton`). An option that `find` prints as `"TXT"` with no role can still be pressed: `cc press "TXT"`, with no role, when the text is on the page once. Check the form changed (a field appears or the value shows) before going on.
- **An option below the list's fold**, or **two buttons with one label** (two "Continue" buttons in one dialog): take the window's capture and click a pixel. `cua-driver call get_window_state '{"pid":<pid>,"window_id":<id>,"include_accessibility_tree":false,"include_screenshot":true}'` returns `screenshot_png_b64`; decode it, read the point off the image, then `cc click <x> <y>`. The pixels are the capture's, not the screen's.
- **A field whose label is its placeholder** ("example.com", "Use @ for root"): `fill` takes the placeholder as the label. After the first fill the field may be found by its real label instead ("Name"); `cc read` shows which.
- **A picker or menu that covers the page**: `click` a blank spot outside it to close it; `key escape` is refused with several windows.

## Add a domain to a DNS dashboard (Cloudflare, measured 2026-11-17)

1. Before anything: `dig +short <domain> NS`, `A`, `AAAA`, `MX`, `TXT`, `CAA`, `www`, and `DS`. Save what exists. A DS record means DNSSEC is on at the registrar; turn it off there first or the switch breaks the domain.
2. Domains → "Add domain" → "Connect a domain". `fill` the domain, `press "Continue" button`.
3. Plan page: the plan buttons all read "Select plan"; `click` the one under the plan you mean.
4. Review the scanned records. Compare each with step 1. Set every record to "DNS only" (`press "Switch" checkbox "<record content>"`, the row text picks the row) so nothing changes for visitors until proxying is tested on its own.
5. "Continue to activation"; a warning about DNS-only records offers "I'll do this later". The next page names the two nameservers.
6. Check before the registrar change: `dig +short @<new nameserver> <domain> A` must give the same answers as step 1.
7. The nameserver change at the registrar is the owner's step if the registrar asks for a password or a code.

## Analytics property and search verification (Google, measured 2026-11-17)

- Analytics: Admin (gear, bottom left; `click` it) → Create → Property. Name, then industry (a dropdown: open it, `click` the option from the capture), size, objectives, "Create a property", platform "Web", URL and stream name, "Create & continue". The measurement ID shows after "Select stream" as `G-…`; it is public.
- Search Console: "Add a website" → Domain → `fill "example.com"` → the Domain card's Continue (`click`, two buttons share the label). It shows a `google-site-verification=…` TXT value; add it at the DNS host, then "Verify later" until `dig +short <domain> TXT` shows it from the live nameservers.

## Report on event parameters in Analytics (Google, measured 2026-11-17)

- Pick the property first. An admin address with `p0` in it has no property selected. `press "Open the universal picker." button`, then `press "<property name> <property number> Star item" link`. The address bar (`read --ui`) then shows `a<account>p<property>`; check it before changing anything.
- A new property opens on its setup wizard ("Start collecting data"). `press "Next" button`, then `press "Continue to Home" link`, then `press "Admin" link`.
- The stream panel ("Select stream") lists enhanced measurement: `press "Show N more active enhanced measurements." button` and `read`. Outbound clicks and site search come from there with no code.
- Custom dimensions: Admin → `press "Custom definitions" link` → `press "Create custom dimension" popupbutton`. `fill "Dimension name" "<name>" textfield`, `fill "Event parameter" "<parameter>" combobox` (a parameter not yet received can be typed), `fill "Description" "<text>" textfield`, `press "Save" button`. The table count ("1 – N of N") confirms each one.
- Key events: Admin → `press "Events" button` → `press "Key events" radiobutton`. An event is marked by its star in the list, and the list holds only events already received. An event that has not fired yet cannot be marked; mark it after its first hit.
- `open` can leave the address in the new tab's search box without going there. Moving inside the site by its own links (Admin, the left menu) avoids that.

## Stop points

- A password, passkey or one-time code: exit 2. That step is the owner's.
- Creating an account or property, changing nameservers, accepting terms: ask the owner first; the tool does not decide these.
