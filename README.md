# Group Tabs – Export & Restore

A lightweight browser extension for Chrome and Edge that exports your tab groups to
a JSON file and restores them later — on the same machine or a new one. Everything
runs locally; nothing is uploaded.

## Features

- Export every tab group (name, color, collapsed state, and links) from all open windows.
- Restore groups exactly as they were, in new windows or the current one.
- Lazy restore: tabs open as lightweight placeholders and load the real page only
  when you open them, so importing hundreds of tabs stays fast.
- File-based or clipboard-based transfer.
- No accounts, no servers, no tracking.

## Install (unpacked)

**Chrome** — open `chrome://extensions`, enable **Developer mode**, click
**Load unpacked**, and select this folder.

**Edge** — open `edge://extensions`, enable **Developer mode**, click
**Load unpacked**, and select this folder.

## Usage

**Export** — click the toolbar icon, then **Download JSON** (or **Copy JSON**).
The file is named `tab-groups-YYYY-MM-DD.json`.

**Restore** — click the toolbar icon, then choose your `.json` file under
**Import** (or paste the JSON text). Your groups are recreated.

### Options

- **Open in a new window** — recreate each exported window separately. Turn off to
  place all groups into the current window.
- **Load tabs lazily** — open tabs as placeholders that load on first view.
  Recommended when restoring a large number of tabs.

## What an export contains

For each group in each open window: the group name, color, collapsed state, and the
URL and title of every tab. Ungrouped tabs are not included. Internal pages such as
`chrome://` and `edge://` cannot be reopened directly by extensions and are restored
as clickable placeholders instead.

## Permissions

- `tabs` — read tab URLs and titles for export, and open tabs on restore.
- `tabGroups` — read group names and colors on export, and recreate groups on restore.

No host permissions are requested and no network access is used.

## Privacy

The extension does not collect, store, or transmit any data. Tab information is read
only to build the file you save, and that file stays on your device. See
[PRIVACY.md](PRIVACY.md).

## Packaging for the Chrome Web Store

Create the upload archive with only the files the extension needs:

```powershell
Compress-Archive -Path manifest.json, popup.html, popup.css, popup.js, suspended.html, suspended.js, icons -DestinationPath dist\group-tabs.zip -Force
```

Then upload `dist\group-tabs.zip` in the
[Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

### Store listing reference

- **Category:** Productivity
- **Single purpose:** Export tab groups to a file and restore them in any Chromium browser.
- **Permission justification — `tabs`:** Needed to read the URLs and titles of open
  tabs so they can be exported, and to open tabs when restoring.
- **Permission justification — `tabGroups`:** Needed to read tab group names and
  colors when exporting, and to recreate the groups when importing.
- **Data usage:** Declare that no user data is collected or transmitted. All
  processing happens locally in the browser.
- **Privacy policy:** Host `PRIVACY.md` at a public URL and enter it in the dashboard.

The same package also works on the
[Microsoft Edge Add-ons](https://partner.microsoft.com/dashboard/microsoftedge) store.

## License

Released under the MIT License. See [LICENSE](LICENSE).
