async function request(path, options = {}) {
  const response = await fetch(path, { cache: "no-store", ...options });
  let data;
  try { data = await response.json(); } catch { throw new Error("HTTP " + response.status); }
  if (!response.ok) throw new Error(data.error || "HTTP " + response.status);
  return data;
}

export function loadSettings() {
  return request("/api/settings");
}

export function saveLocale(locale) {
  return request("/api/settings/app", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale })
  });
}

export function saveCategory(category) {
  return request("/api/settings/prompts/" + encodeURIComponent(category.id), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(category)
  });
}
