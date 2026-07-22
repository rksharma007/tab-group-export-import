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

// Empty/new-tab pages carry no useful state, so they are dropped from exports.
function isBlankTab(url) {
  return (
    !url ||
    /^about:(blank|newtab)/i.test(url) ||
    /^(chrome|edge):\/\/(newtab|new-tab-page)\/?/i.test(url)
  );
}

async function collectGroups(options = {}) {
  const includeUngrouped = options.includeUngrouped === true;
  const groups = await chrome.tabGroups.query({});
  const meta = new Map(groups.map((g) => [g.id, g]));
  const windows = await chrome.windows.getAll({ populate: true });

  const result = [];
  let groupCount = 0;
  let tabCount = 0;
  let ungroupedCount = 0;

  for (const win of windows) {
    const buckets = new Map();
    const loose = [];
    for (const tab of win.tabs || []) {
      if (tab.groupId == null || tab.groupId === NONE) {
        if (includeUngrouped) loose.push(tab);
        continue;
      }
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

    const ungrouped = includeUngrouped
      ? loose
          .sort((a, b) => a.index - b.index)
          .map((t) => {
            const link = { url: t.url || t.pendingUrl || "", title: t.title || "" };
            if (t.pinned) link.pinned = true;
            return link;
          })
          .filter((t) => !isBlankTab(t.url))
      : [];
    ungroupedCount += ungrouped.length;

    if (windowGroups.length || ungrouped.length) {
      const entry = { groups: windowGroups };
      if (ungrouped.length) entry.ungrouped = ungrouped;
      result.push(entry);
    }
  }

  return { windows: result, groupCount, tabCount, ungroupedCount };
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

function exportSummary(groupCount, tabCount, ungroupedCount) {
  const parts = [];
  if (groupCount) parts.push(`${pluralize(groupCount, "group")} (${pluralize(tabCount, "tab")})`);
  if (ungroupedCount) parts.push(pluralize(ungroupedCount, "ungrouped tab"));
  return parts.join(" and ");
}

async function refreshSummary() {
  try {
    const includeUngrouped = $("optUngrouped").checked;
    const { groupCount, tabCount, ungroupedCount } = await collectGroups({ includeUngrouped });
    let text = `${pluralize(groupCount, "group")} · ${pluralize(tabCount, "tab")}`;
    if (includeUngrouped && ungroupedCount) text += ` · ${ungroupedCount} ungrouped`;
    $("summary").textContent = text;

    const nothing = groupCount === 0 && !(includeUngrouped && ungroupedCount > 0);
    $("exportFile").disabled = nothing;
    $("exportCopy").disabled = nothing;
    if (nothing) {
      setStatus(
        includeUngrouped ? "No groups or ungrouped tabs to export." : "No tab groups are open right now.",
        "warn"
      );
    } else if ($("status").classList.contains("warn")) {
      setStatus("");
    }
  } catch (err) {
    $("summary").textContent = "—";
    setStatus("Could not read tabs: " + err.message, "err");
  }
}

async function exportToFile() {
  try {
    const includeUngrouped = $("optUngrouped").checked;
    const { windows, groupCount, tabCount, ungroupedCount } = await collectGroups({ includeUngrouped });
    if (!groupCount && !ungroupedCount) return setStatus("Nothing to export.", "warn");
    saveFile(JSON.stringify(buildExport(windows), null, 2), exportFileName());
    setStatus(`Saved ${exportSummary(groupCount, tabCount, ungroupedCount)} to your downloads.`, "ok");
  } catch (err) {
    setStatus("Export failed: " + err.message, "err");
  }
}

async function exportToClipboard() {
  try {
    const includeUngrouped = $("optUngrouped").checked;
    const { windows, groupCount, tabCount, ungroupedCount } = await collectGroups({ includeUngrouped });
    if (!groupCount && !ungroupedCount) return setStatus("Nothing to export.", "warn");
    await navigator.clipboard.writeText(JSON.stringify(buildExport(windows), null, 2));
    setStatus(`Copied ${exportSummary(groupCount, tabCount, ungroupedCount)} to the clipboard.`, "ok");
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
  const stats = { windows: 0, groups: 0, tabs: 0, ungrouped: 0, skipped: 0 };

  for (const win of data.windows) {
    const groups = win.groups || [];
    const ungrouped = win.ungrouped || [];
    if (!groups.length && !ungrouped.length) continue;

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
          setStatus(`Restoring… ${pluralize(stats.tabs + stats.ungrouped, "tab")}`, "busy");
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

    for (const tab of ungrouped) {
      if (!tab || !tab.url) continue;
      const id = await openTab(windowId, tab.url, tab.title, options.lazy);
      if (id == null) {
        stats.skipped += 1;
        continue;
      }
      stats.ungrouped += 1;
      if (tab.pinned) {
        try {
          await chrome.tabs.update(id, { pinned: true });
        } catch {
          // Pinning is best-effort and never aborts the restore.
        }
      }
      setStatus(`Restoring… ${pluralize(stats.tabs + stats.ungrouped, "tab")}`, "busy");
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
    const parts = [];
    if (stats.groups) parts.push(`${pluralize(stats.groups, "group")} (${pluralize(stats.tabs, "tab")})`);
    if (stats.ungrouped) parts.push(pluralize(stats.ungrouped, "ungrouped tab"));
    let message = "Restored " + (parts.join(" and ") || "nothing");
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

function readFile(file) {
  const reader = new FileReader();
  reader.onload = () => importFrom(String(reader.result || ""));
  reader.onerror = () => setStatus("Could not read that file.", "err");
  reader.readAsText(file);
}

function onFileChosen(event) {
  const file = event.target.files && event.target.files[0];
  if (file) readFile(file);
  event.target.value = "";
}

function setupDropzone() {
  const zone = $("dropzone");
  if (!zone) return;
  const stop = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  ["dragenter", "dragover"].forEach((evt) =>
    zone.addEventListener(evt, (e) => {
      stop(e);
      zone.classList.add("dragover");
    })
  );
  ["dragleave", "dragend"].forEach((evt) =>
    zone.addEventListener(evt, (e) => {
      stop(e);
      zone.classList.remove("dragover");
    })
  );
  zone.addEventListener("drop", (e) => {
    stop(e);
    zone.classList.remove("dragover");
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) readFile(file);
  });
}

function onImportText() {
  const text = $("importText").value.trim();
  if (!text) return setStatus("Paste exported JSON first.", "warn");
  importFrom(text);
}

document.addEventListener("DOMContentLoaded", () => {
  $("exportFile").addEventListener("click", exportToFile);
  $("exportCopy").addEventListener("click", exportToClipboard);
  $("optUngrouped").addEventListener("change", refreshSummary);
  $("importFile").addEventListener("change", onFileChosen);
  $("importTextBtn").addEventListener("click", onImportText);
  setupDropzone();
  ["dragover", "drop"].forEach((evt) =>
    window.addEventListener(evt, (e) => e.preventDefault())
  );
  refreshSummary();
});
