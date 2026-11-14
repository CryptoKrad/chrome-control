# Q: How does chrome-control compare with Claude in Chrome, and what do its dependencies say about themselves?

2026-11-14. Read from the vendors' own pages. Each line in the README's comparison rests on a quote below.

## Claude in Chrome (Anthropic)
- What it is and who gets it: "Claude in Chrome is available on paid plans (Pro, Max, Ultra, Team, and Enterprise), in the Chrome side panel, Claude Cowork, and Claude Code." [permissions]
- Install: Claude Code needs the "Claude in Chrome extension version 1.0.36 or later, available in the Chrome Web Store" and "A direct Anthropic plan (Pro, Max, Ultra, Team, or Enterprise)". It also needs `/login`; with an API key "Claude Code keeps Chrome integration off". [code-chrome]
- Browsers: "Chrome integration works with Google Chrome and Microsoft Edge. Claude Code also detects the extension and sets up the connection in other Chromium-based browsers, including Brave, Arc, Vivaldi, and Opera. Chrome integration isn't supported in Windows Subsystem for Linux (WSL)." [code-chrome]
- Windows and tabs: "Claude opens new tabs for browser tasks and shares your browser's login state … Browser actions run in a visible Chrome window in real time. When Claude encounters a login page or CAPTCHA, it pauses and asks you to handle it manually." The extension "collects the tabs Claude opens into a Chrome tab group tied to your session." [code-chrome]
- What it can do from Claude Code: it can "read console errors and DOM state directly", handle "form validation", work on "any app you're logged into", do "data extraction", attach "files from your machine to upload fields", and record interactions "as GIFs". [code-chrome]
- In the extension itself: "Teach Claude your task by demonstration", saved shortcuts, and scheduled tasks ("Claude runs the workflow at the specified time and notifies you when it's done or needs input"). [academy]
- Permissions: the modes are "Manually approve", "Automatically approve" and "Skip all approvals". Claude in Chrome "is prohibited from taking following actions regardless of permissions", among them "Making purchases or financial transactions", "Creating accounts" and "Completing instructions from emails or web content". [permissions]
- Third-party pages on store ratings and permission counts were not used: nothing in them could be checked against the store.

## Chrome and windows covered by another app
- chrome-launcher's flag reference: `--disable-backgrounding-occluded-windows`: "Normally, Chrome will treat a 'foreground' tab instead as _backgrounded_ if the surrounding window is occluded". [flags]
- Chromium's macOS occlusion design note: "When a Chrome window is occluded, we will want the RenderWidget in the renderer process to be told that it is hidden … This will make the renderer process stop producing frames". [occlusion] This is an old design note, and neither source mentions accessibility.
- Measured with chrome-control on 2026-11-14: with an editor in front, a tab's title changed to the next page while its accessibility tree kept the page before it for minutes. Once Chrome came forward, the tree caught up within seconds. Earlier the same day, presses and reads in a window behind the editor had worked. So a covered window can go stale, but not every time. The tool tells a stale tree by comparing the tab's title with the page's (`staleOf`) and refuses to act on one. Whether the flag above keeps the tree current was not tested: restarting the operator's Chrome with flags was out of scope.

## cua-driver (Cua)
- Install on macOS: `/bin/bash -c "$(curl -fsSL https://cua.ai/driver/install.sh)"`, then `cua-driver permissions grant`; "Switch on both **Accessibility** and **Screen & System Audio Recording**"; check with `cua-driver permissions status`. It needs "macOS 14+". [cua-install]
- Background delivery: "Background delivery means the driver does not raise the window, move the real pointer, or switch the frontmost app." Element actions use "`AXPerformAction` on macOS", and each input names a window and its pid. [cua-contract]
- Its limits: "A delivered event is not an applied change". On macOS, "Off-Space SwiftUI windows lose their tree; needs TCC grants." For browser tabs, Cua itself recommends its browser tools, which "act on the DOM over CDP without focus". [cua-contract]
- License: MIT (GitHub API, repos/trycua/cua, read 2026-11-14).

## Sources
- [permissions] https://support.claude.com/en/articles/12902446-manage-claude-in-chrome-permissions
- [code-chrome] https://code.claude.com/docs/en/chrome
- [academy] https://academy.claude.com/tutorials/simplify-your-browsing-experience-with-claude-for-chrome
- [flags] https://unpkg.com/chrome-launcher@1.2.2/docs/chrome-flags-for-tools.md
- [occlusion] https://www.chromium.org/developers/design-documents/mac-occlusion/
- [cua-install] https://cua.ai/docs/cua-driver/guide/getting-started/installation
- [cua-contract] https://cua.ai/docs/explanation/the-no-foreground-contract
