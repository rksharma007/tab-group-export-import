"use strict";

const NONE = chrome.tabGroups ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1;
const COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

const $ = (id) => document.getElementById(id);
let busy = false;

function setStatus(message, kind = "") {
  const el = $("status");
  el.textContent = message;
  el.className = "status" + (kind ? " " + kind : "");
}

function normalizeColor(color) {
  return COLORS.includes(color) ? color : "grey";
}

async function collectGroups() {
  const groups = await chrome.tabGroups.query({});
  const meta = new Map(groups.map((g) => [g.id, g]));
  const windows = await chrome.windows.getAll({ populate: true });

  const result = [];
  let groupCount = 0;
  let tabCount = 0;

  for (const win of windows) {
    const buckets = new Map();
    for (const tab of win.tabs || []) {
      if (tab.groupId == null || tab.groupId === NONE) continue;
      if (!buckets.has(tab.groupId)) buckets.set(tab.groupId, []);
      buckets.get(tab.groupId).push(tab);
    }

    const windowGroups = [];
    for (const [id, tabs] of buckets) {
      const info = meta.get(id) || {};
      const links = tabs
        .sort((a, b) => a.index - b.index)
        .map((t) => ({ url: t.url || t.pendingUrl || "", title: t.title || "" }))
        .filter((t) => t.url);
      if (!links.length) continue;
      windowGroups.push({
        title: info.title || "",
        color: normalizeColor(info.color),
        collapsed: Boolean(info.collapsed),
        tabs: links,
      });
      groupCount += 1;
      tabCount += links.length;
    }

    if (windowGroups.length) result.push({ groups: windowGroups });
  }

  return { windows: result, groupCount, tabCount };
}

function buildExport(windows) {
  return {
    format: "tab-group-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    windows,
  };
}

function exportFileName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `tab-groups-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
}

function saveFile(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function pluralize(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

async function refreshSummary() {
  try {
    const { groupCount, tabCount } = await collectGroups();
    $("summary").textContent = `${pluralize(groupCount, "group")} · ${pluralize(tabCount, "tab")}`;
    const empty = groupCount === 0;
    $("exportFile").disabled = empty;
    $("exportCopy").disabled = empty;
    if (empty) setStatus("No tab groups are open right now.", "warn");
  } catch (err) {
    $("summary").textContent = "—";
    setStatus("Could not read tab groups: " + err.message, "err");
  }
}

async function exportToFile() {
  try {
    const { windows, groupCount, tabCount } = await collectGroups();
    if (!groupCount) return setStatus("Nothing to export.", "warn");
    saveFile(JSON.stringify(buildExport(windows), null, 2), exportFileName());
    setStatus(`Saved ${pluralize(groupCount, "group")} (${pluralize(tabCount, "tab")}) to your downloads.`, "ok");
  } catch (err) {
    setStatus("Export failed: " + err.message, "err");
  }
}

async function exportToClipboard() {
  try {
    const { windows, groupCount, tabCount } = await collectGroups();
    if (!groupCount) return setStatus("Nothing to export.", "warn");
    await navigator.clipboard.writeText(JSON.stringify(buildExport(windows), null, 2));
    setStatus(`Copied ${pluralize(groupCount, "group")} (${pluralize(tabCount, "tab")}) to the clipboard.`, "ok");
  } catch (err) {
    setStatus("Copy failed: " + err.message, "err");
  }
}

function placeholderUrl(url, title) {
  const base = chrome.runtime.getURL("suspended.html");
  return `${base}#u=${encodeURIComponent(url)}&t=${encodeURIComponent(title || "")}`;
}

function parseExport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  if (!parsed || !Array.isArray(parsed.windows)) {
    throw new Error("This does not look like an export file.");
  }
  return parsed;
}

async function openTab(windowId, url, title, lazy) {
  try {
    const target = lazy ? placeholderUrl(url, title) : url;
    const tab = await chrome.tabs.create({ windowId, url: target, active: false });
    return tab.id;
  } catch {
    // chrome://, edge:// and file:// pages cannot be opened directly by an
    // extension, so fall back to a placeholder the user can click to reopen.
    if (lazy) return null;
    try {
      const tab = await chrome.tabs.create({ windowId, url: placeholderUrl(url, title), active: false });
      return tab.id;
    } catch {
      return null;
    }
  }
}

async function restore(data, options) {
  const stats = { windows: 0, groups: 0, tabs: 0, skipped: 0 };

  for (const win of data.windows) {
    const groups = win.groups || [];
    if (!groups.length) continue;

    let windowId;
    let blankTabId = null;
    if (options.newWindow) {
      const created = await chrome.windows.create({ focused: false });
      windowId = created.id;
      blankTabId = created.tabs && created.tabs[0] ? created.tabs[0].id : null;
      stats.windows += 1;
    } else {
      windowId = (await chrome.windows.getCurrent()).id;
    }

    for (const group of groups) {
      const tabIds = [];
      for (const tab of group.tabs || []) {
        if (!tab || !tab.url) continue;
        const id = await openTab(windowId, tab.url, tab.title, options.lazy);
        if (id == null) {
          stats.skipped += 1;
        } else {
          tabIds.push(id);
          stats.tabs += 1;
          setStatus(`Restoring… ${pluralize(stats.tabs, "tab")}`, "busy");
        }
      }
      if (!tabIds.length) continue;

      const groupId = await chrome.tabs.group({ tabIds });
      try {
        await chrome.tabGroups.update(groupId, {
          title: group.title || "",
          color: normalizeColor(group.color),
          collapsed: Boolean(group.collapsed),
        });
      } catch {
        // Styling is cosmetic; a failure here should not abort the restore.
      }
      stats.groups += 1;
    }

    if (blankTabId != null) {
      try {
        await chrome.tabs.remove(blankTabId);
      } catch {
        /* the placeholder tab may already be gone */
      }
    }
  }

  return stats;
}

async function importFrom(text) {
  if (busy) return;
  busy = true;
  try {
    const data = parseExport(text);
    setStatus("Restoring…", "busy");
    const stats = await restore(data, {
      newWindow: $("optNewWindow").checked,
      lazy: $("optLazy").checked,
    });
    let message = `Restored ${pluralize(stats.groups, "group")} (${pluralize(stats.tabs, "tab")})`;
    if (stats.windows) message += ` in ${pluralize(stats.windows, "new window")}`;
    message += ".";
    if (stats.skipped) message += ` ${pluralize(stats.skipped, "tab")} skipped.`;
    setStatus(message, stats.skipped ? "warn" : "ok");
  } catch (err) {
    setStatus("Import failed: " + err.message, "err");
  } finally {
    busy = false;
  }
}

function onFileChosen(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => importFrom(String(reader.result || ""));
  reader.onerror = () => setStatus("Could not read that file.", "err");
  reader.readAsText(file);
  event.target.value = "";
}

function onImportText() {
  const text = $("importText").value.trim();
  if (!text) return setStatus("Paste exported JSON first.", "warn");
  importFrom(text);
}

document.addEventListener("DOMContentLoaded", () => {
  $("exportFile").addEventListener("click", exportToFile);
  $("exportCopy").addEventListener("click", exportToClipboard);
  $("importFile").addEventListener("change", onFileChosen);
  $("importTextBtn").addEventListener("click", onImportText);
  refreshSummary();
});
