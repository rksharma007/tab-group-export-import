"use strict";

const params = new URLSearchParams(location.hash.slice(1));
const url = params.get("u") || "";
const title = params.get("t") || "";

document.title = title || url || "Suspended tab";
document.getElementById("title").textContent = title || "(untitled)";
document.getElementById("url").textContent = url;

let loaded = false;
function load() {
  if (loaded || !url) return;
  loaded = true;
  location.replace(url);
}

document.getElementById("restore").addEventListener("click", load);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") load();
});

if (document.visibilityState === "visible") load();
