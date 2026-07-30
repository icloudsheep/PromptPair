import { loadSettings, saveCategory, saveLocale } from "../services/settings-service.js";
import { escapeHtml, icon, interpolate } from "../utils/dom.js";

export function initializeSettings({ app, messages, categories, onCatalogChange }) {
  const view = document.querySelector("#settings-view");
  const openButton = document.querySelector("#settings-button");
  const closeButton = document.querySelector("#settings-close");
  const navigation = document.querySelector("#settings-nav");
  const localeSelect = document.querySelector("#locale-select");
  const categoryList = document.querySelector("#settings-categories");
  const blockList = document.querySelector("#settings-blocks");
  const form = document.querySelector("#block-form");
  const empty = document.querySelector("#block-form-empty");
  const fields = document.querySelector("#block-form-fields");
  const status = document.querySelector("#settings-save-status");
  const typeSelect = form.elements.type;
  const saveTimers = new Map();
  const savingCategories = new Set();
  const pendingCategories = new Set();
  const categoryVersions = new Map(categories.map((category) => [category.id, 0]));
  let catalog = structuredClone(categories);
  let currentApp = structuredClone(app);
  let selectedCategoryId = catalog[0]?.id || null;
  let selectedBlockId = catalog[0]?.blocks[0]?.id || null;
  let statusVersion = 0;
  let settingsLoaded = false;

  openButton.innerHTML = icon("settings");
  openButton.ariaLabel = messages.app.settings;
  closeButton.innerHTML = icon("close");
  closeButton.ariaLabel = messages.settings.close;
  navigation.ariaLabel = messages.settings.title;
  typeSelect.innerHTML = Object.entries(messages.types).map(([value, label]) =>
    `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`
  ).join("");

  const selectedCategory = () => catalog.find((category) => category.id === selectedCategoryId);
  const selectedBlock = () => selectedCategory()?.blocks.find((block) => block.id === selectedBlockId);

  const renderLocale = () => {
    localeSelect.innerHTML = currentApp.locales.map((locale) =>
      `<option value="${escapeHtml(locale.id)}">${escapeHtml(locale.name)}</option>`
    ).join("");
    localeSelect.value = currentApp.locale;
  };

  const renderCategories = () => {
    categoryList.innerHTML = catalog.map((category) => `
      <button class="settings-list-item ${category.id === selectedCategoryId ? "active" : ""}" type="button" data-category="${escapeHtml(category.id)}">
        <i style="--item-color:${category.color}"></i><span><strong>${escapeHtml(category.name)}</strong><small>${escapeHtml(category.description)}</small></span>
      </button>
    `).join("");
  };

  const renderBlocks = () => {
    const category = selectedCategory();
    blockList.innerHTML = category ? category.blocks.map((block) => `
      <button class="settings-list-item ${block.id === selectedBlockId ? "active" : ""}" type="button" data-block="${escapeHtml(block.id)}">
        <span class="settings-block-icon">${escapeHtml(block.icon)}</span><span><strong>${escapeHtml(block.name)}</strong><small>${escapeHtml(messages.types[block.type] || block.type)}</small></span>
      </button>
    `).join("") : "";
  };

  const renderForm = () => {
    const category = selectedCategory();
    const block = selectedBlock();
    empty.hidden = Boolean(category && block);
    fields.hidden = !category || !block;
    if (!category || !block) return;
    form.elements.categoryName.value = category.name;
    form.elements.categoryDescription.value = category.description;
    form.elements.name.value = block.name;
    form.elements.icon.value = block.icon;
    form.elements.summary.value = block.summary;
    form.elements.type.value = block.type;
    form.elements.prompt.value = block.prompt;
  };

  const renderEditor = () => {
    renderCategories();
    renderBlocks();
    renderForm();
  };

  const setStatus = (message, state = "") => {
    status.textContent = message;
    status.dataset.state = state;
  };

  const persistCategory = async (categoryId) => {
    if (savingCategories.has(categoryId)) {
      pendingCategories.add(categoryId);
      return;
    }
    const version = ++statusVersion;
    const category = catalog.find((item) => item.id === categoryId);
    if (!category) return;
    const categoryVersion = categoryVersions.get(categoryId) || 0;
    const snapshot = structuredClone(category);
    savingCategories.add(categoryId);
    setStatus(messages.settings.saving, "saving");
    try {
      const { category: saved } = await saveCategory(snapshot);
      if ((categoryVersions.get(categoryId) || 0) === categoryVersion) {
        const index = catalog.findIndex((item) => item.id === categoryId);
        catalog[index] = { ...saved, color: snapshot.color };
        onCatalogChange(structuredClone(catalog));
        renderEditor();
        if (version === statusVersion) setStatus(messages.settings.saved, "saved");
      }
    } catch (error) {
      if (version === statusVersion) setStatus(interpolate(messages.settings.saveFailed, { message: error.message }), "error");
    } finally {
      savingCategories.delete(categoryId);
      if (pendingCategories.delete(categoryId) || (categoryVersions.get(categoryId) || 0) !== categoryVersion) {
        persistCategory(categoryId);
      }
    }
  };

  const scheduleSave = (categoryId) => {
    window.clearTimeout(saveTimers.get(categoryId));
    setStatus(messages.settings.saving, "saving");
    saveTimers.set(categoryId, window.setTimeout(() => {
      saveTimers.delete(categoryId);
      persistCategory(categoryId);
    }, 500));
  };

  const refreshSettings = async () => {
    const settings = await loadSettings();
    currentApp = settings.app;
    catalog = settings.categories;
    categoryVersions.clear();
    catalog.forEach((category) => categoryVersions.set(category.id, 0));
    if (!catalog.some((category) => category.id === selectedCategoryId)) selectedCategoryId = catalog[0]?.id || null;
    const category = selectedCategory();
    if (!category?.blocks.some((block) => block.id === selectedBlockId)) selectedBlockId = category?.blocks[0]?.id || null;
    renderLocale();
    renderEditor();
  };

  const open = async () => {
    view.hidden = false;
    document.body.classList.add("settings-open");
    view.animate(
      [{ opacity: 0, transform: "translateY(14px) scale(.99)" }, { opacity: 1, transform: "translateY(0) scale(1)" }],
      { duration: 320, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "both" }
    );
    setStatus("");
    if (!settingsLoaded) {
      try {
        await refreshSettings();
        settingsLoaded = true;
      } catch (error) {
        setStatus(interpolate(messages.settings.saveFailed, { message: error.message }), "error");
      }
    }
    closeButton.focus();
  };

  const close = () => {
    if (view.hidden || view.dataset.closing === "true") return;
    view.dataset.closing = "true";
    const animation = view.animate(
      [{ opacity: 1, transform: "translateY(0) scale(1)" }, { opacity: 0, transform: "translateY(12px) scale(.99)" }],
      { duration: 220, easing: "cubic-bezier(.55, 0, 1, .45)", fill: "forwards" }
    );
    animation.finished.finally(() => {
      view.hidden = true;
      delete view.dataset.closing;
      document.body.classList.remove("settings-open");
      openButton.focus();
    });
  };

  openButton.addEventListener("click", open);
  closeButton.addEventListener("click", close);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !view.hidden) close();
  });
  navigation.addEventListener("click", (event) => {
    const button = event.target.closest("[data-section]");
    if (!button) return;
    navigation.querySelectorAll("[data-section]").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-settings-section]").forEach((section) => {
      section.hidden = section.dataset.settingsSection !== button.dataset.section;
      if (!section.hidden) {
        section.animate(
          [{ transform: "translateX(12px)" }, { transform: "translateX(0)" }],
          { duration: 260, easing: "cubic-bezier(.22, 1, .36, 1)" }
        );
      }
    });
  });
  localeSelect.addEventListener("change", async () => {
    setStatus(messages.settings.saving, "saving");
    try {
      await saveLocale(localeSelect.value);
      setStatus(messages.settings.saved, "saved");
      window.location.reload();
    } catch (error) {
      localeSelect.value = currentApp.locale;
      setStatus(interpolate(messages.settings.saveFailed, { message: error.message }), "error");
    }
  });
  categoryList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    selectedCategoryId = button.dataset.category;
    selectedBlockId = selectedCategory()?.blocks[0]?.id || null;
    renderEditor();
  });
  blockList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-block]");
    if (!button) return;
    selectedBlockId = button.dataset.block;
    renderEditor();
  });
  form.addEventListener("input", () => {
    const category = selectedCategory();
    const block = selectedBlock();
    if (!category || !block || !form.checkValidity()) return;
    category.name = form.elements.categoryName.value;
    category.description = form.elements.categoryDescription.value;
    block.name = form.elements.name.value;
    block.icon = form.elements.icon.value;
    block.summary = form.elements.summary.value;
    block.type = form.elements.type.value;
    block.prompt = form.elements.prompt.value;
    categoryVersions.set(category.id, (categoryVersions.get(category.id) || 0) + 1);
    renderCategories();
    renderBlocks();
    scheduleSave(category.id);
  });
  form.addEventListener("submit", (event) => event.preventDefault());

  renderLocale();
  renderEditor();
}
