const paths = {
  search: "<circle cx='11' cy='11' r='7'></circle><path d='m20 20-4-4'></path>",
  moon: "<path d='M21 12.8A8.5 8.5 0 1 1 11.2 3 6.5 6.5 0 0 0 21 12.8Z'></path>",
  sun: "<circle cx='12' cy='12' r='4'></circle><path d='M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41'></path>",
  github: "<path d='M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.28-.36 6.72-1.61 6.72-7.25A5.7 5.7 0 0 0 19.22 3.3 5.3 5.3 0 0 0 19.07 0S17.89-.38 15 1.48a13.4 13.4 0 0 0-7 0C5.11-.38 3.93 0 3.93 0a5.3 5.3 0 0 0-.15 3.3 5.7 5.7 0 0 0-1.5 3.95c0 5.63 3.44 6.88 6.72 7.25A4.8 4.8 0 0 0 8 18v4M8 19c-3 .92-3-1.5-4-2'></path>",
  spark: "<path d='m12 3-1.5 4.5L6 9l4.5 1.5L12 15l1.5-4.5L18 9l-4.5-1.5L12 3Z'></path><path d='m5 15-.7 2.3L2 18l2.3.7L5 21l.7-2.3L8 18l-2.3-.7L5 15Z'></path>",
  arrowUp: "<path d='m18 15-6-6-6 6'></path>", arrowDown: "<path d='m6 9 6 6 6-6'></path>",
  trash: "<path d='M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6'></path>",
  close: "<path d='m6 6 12 12M18 6 6 18'></path>",
  share: "<circle cx='18' cy='5' r='3'></circle><circle cx='6' cy='12' r='3'></circle><circle cx='18' cy='19' r='3'></circle><path d='m8.6 10.5 6.8-4M8.6 13.5l6.8 4'></path>",
  wand: "<path d='m15 4 5 5L8 21H3v-5L15 4ZM13 6l5 5M6 3v4M4 5h4M19 16v4M17 18h4'></path>",
  loader: "<path d='M21 12a9 9 0 1 1-6.2-8.56'></path>",
  settings: "<circle cx='12' cy='12' r='3'></circle><path d='M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.3V9.6h.09A1.7 1.7 0 0 0 4.1 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.5 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.3h4v.09A1.7 1.7 0 0 0 15 4.1a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.5a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.09A1.7 1.7 0 0 0 19.4 15Z'></path>"
};
export function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`; }
export function escapeHtml(value) { const node = document.createElement("span"); node.textContent = value; return node.innerHTML; }
export function interpolate(template, values = {}) { return template.replace(/\{(\w+)}/g, (_, key) => values[key] ?? `{${key}}`); }
export function getMessage(messages, path) { return path.split(".").reduce((value, key) => value?.[key], messages) ?? path; }
export function applyMessages(messages) { document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = getMessage(messages, element.dataset.i18n); }); }
export function showToast(message, type = "info") {
  const toast = document.createElement("div"); toast.className = `toast ${type}`; toast.textContent = message;
  document.querySelector("#toast-region").append(toast); window.setTimeout(() => toast.remove(), 3200);
}
