async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
export async function loadApplication() {
  const app = await fetchJson("/assets/config/app.json");
  const [messages, manifest] = await Promise.all([fetchJson(app.localePath), fetchJson(app.promptManifest)]);
  const categories = await Promise.all(manifest.categories.map(async (entry) => ({ ...await fetchJson(entry.file), color: entry.color })));
  return { app, messages, categories };
}
