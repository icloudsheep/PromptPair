import { createCategory, deleteCategory, loadSettings, saveCategory, saveLocale } from "../services/settings-service.js?v=20260730.10";
import { escapeHtml, icon, interpolate } from "../utils/dom.js?v=20260730.10";

const CATEGORY_COLORS = ["#9b7ac7", "#5e91b8", "#5f9a76", "#c18454", "#b76b73", "#738f77"];

export function initializeSettings({ app, messages, categories, onCatalogChange }) {
  const view = document.querySelector("#settings-view");
  const openButton = document.querySelector("#settings-button");
  const closeButton = document.querySelector("#settings-close");
  const navigation = document.querySelector("#settings-nav");
  const localeSelect = document.querySelector("#locale-select");
  const categoryList = document.querySelector("#settings-categories");
  const blockList = document.querySelector("#settings-blocks");
  const addCategoryButton = document.querySelector("#settings-add-category");
  const addBlockButton = document.querySelector("#settings-add-block");
  const deleteCategoryButton = document.querySelector("#settings-delete-category");
  const deleteBlockButton = document.querySelector("#settings-delete-block");
  const editorTitle = document.querySelector("#settings-editor-title");
  const form = document.querySelector("#block-form");
  const empty = document.querySelector("#block-form-empty");
  const categoryFields = document.querySelector("#settings-category-fields");
  const blockFields = document.querySelector("#settings-block-fields");
  const status = document.querySelector("#settings-save-status");
  const typeSelect = form.elements.type;
  const saveTimers = new Map();
  const savingCategories = new Set();
  const pendingCategories = new Set();
  const deletedCategories = new Set();
  const idleWaiters = new Map();
  const categoryVersions = new Map(categories.map((category) => [category.id, 0]));
  let catalog = structuredClone(categories);
  let currentApp = structuredClone(app);
  let selectedCategoryId = catalog[0]?.id || null;
  let selectedBlockId = null;
  let statusVersion = 0;
  let settingsLoaded = false;
  let operationBusy = false;

  openButton.innerHTML = icon("settings");
  openButton.ariaLabel = messages.app.settings;
  closeButton.innerHTML = icon("close");
  closeButton.ariaLabel = messages.settings.close;
  addCategoryButton.prepend(fragment(icon("plus")));
  addBlockButton.prepend(fragment(icon("plus")));
  deleteCategoryButton.prepend(fragment(icon("trash")));
  deleteBlockButton.prepend(fragment(icon("trash")));
  navigation.ariaLabel = messages.settings.title;
  typeSelect.innerHTML = Object.entries(messages.types).map(([value, label]) =>
    `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`
  ).join("");

  function fragment(html) {
    const template = document.createElement("template");
    template.innerHTML = html;
    return template.content;
  }

  const selectedCategory = () => catalog.find((category) => category.id === selectedCategoryId);
  const selectedBlock = () => selectedCategory()?.blocks.find((block) => block.id === selectedBlockId);

  const uniqueId = (base, usedIds) => {
    let suffix = 1;
    let candidate = base;
    while (usedIds.has(candidate)) candidate = `${base}-${++suffix}`;
    return candidate;
  };

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
    categoryList.toggleAttribute("data-empty", catalog.length === 0);
  };

  const renderBlocks = () => {
    const category = selectedCategory();
    blockList.innerHTML = category?.blocks.map((block) => `
      <button class="settings-list-item ${block.id === selectedBlockId ? "active" : ""}" type="button" data-block="${escapeHtml(block.id)}">
        <span class="settings-block-icon" style="--item-color:${category.color}">${escapeHtml(block.icon)}</span><span><strong>${escapeHtml(block.name)}</strong><small>${escapeHtml(messages.types[block.type] || block.type)}</small></span>
      </button>
    `).join("") || "";
    blockList.toggleAttribute("data-empty", !category?.blocks.length);
  };

  const renderForm = () => {
    const category = selectedCategory();
    const block = selectedBlock();
    const editingCategory = Boolean(category && !block);
    editorTitle.textContent = block ? messages.settings.blockEditorLabel : messages.settings.categoryEditorLabel;
    empty.hidden = Boolean(category);
    categoryFields.hidden = !editingCategory;
    blockFields.hidden = !block;
    categoryFields.querySelectorAll("input, textarea, select").forEach((control) => { control.disabled = !editingCategory; });
    blockFields.querySelectorAll("input, textarea, select").forEach((control) => { control.disabled = !block; });
    addBlockButton.disabled = !category || operationBusy;
    deleteCategoryButton.hidden = !editingCategory;
    deleteCategoryButton.disabled = !editingCategory || operationBusy;
    deleteBlockButton.hidden = !block;
    deleteBlockButton.disabled = !block || operationBusy;
    addCategoryButton.disabled = operationBusy;
    if (!category) return;
    form.elements.categoryName.value = category.name;
    form.elements.categoryDescription.value = category.description;
    form.elements.categoryColor.value = category.color;
    if (!block) return;
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

  const publishCatalog = () => onCatalogChange(structuredClone(catalog));

  const resolveIdleWaiters = (categoryId) => {
    if (savingCategories.has(categoryId)) return;
    const waiters = idleWaiters.get(categoryId) || [];
    idleWaiters.delete(categoryId);
    waiters.forEach((resolve) => resolve());
  };

  const waitForCategoryIdle = (categoryId) => {
    if (!savingCategories.has(categoryId)) return Promise.resolve();
    return new Promise((resolve) => {
      const waiters = idleWaiters.get(categoryId) || [];
      waiters.push(resolve);
      idleWaiters.set(categoryId, waiters);
    });
  };

  const persistCategory = async (categoryId) => {
    if (deletedCategories.has(categoryId)) return;
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
      if (!deletedCategories.has(categoryId) && (categoryVersions.get(categoryId) || 0) === categoryVersion) {
        const index = catalog.findIndex((item) => item.id === categoryId);
        if (index >= 0) catalog[index] = { ...saved, color: snapshot.color };
        publishCatalog();
        renderEditor();
        if (version === statusVersion) setStatus(messages.settings.saved, "saved");
      }
    } catch (error) {
      if (version === statusVersion) setStatus(interpolate(messages.settings.saveFailed, { message: error.message }), "error");
    } finally {
      savingCategories.delete(categoryId);
      if (!deletedCategories.has(categoryId) && pendingCategories.delete(categoryId)) {
        persistCategory(categoryId);
      }
      resolveIdleWaiters(categoryId);
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

  const cancelScheduledSave = (categoryId) => {
    window.clearTimeout(saveTimers.get(categoryId));
    saveTimers.delete(categoryId);
    pendingCategories.delete(categoryId);
    categoryVersions.set(categoryId, (categoryVersions.get(categoryId) || 0) + 1);
  };

  const animateRemoval = async (element) => {
    if (!element) return;
    await element.animate(
      [{ opacity: 1, transform: "translateX(0) scale(1)" }, { opacity: 0, transform: "translateX(-12px) scale(.96)" }],
      { duration: 220, easing: "cubic-bezier(.55, 0, 1, .45)", fill: "forwards" }
    ).finished.catch(() => {});
  };

  const refreshSettings = async () => {
    const settings = await loadSettings();
    currentApp = settings.app;
    catalog = settings.categories;
    categoryVersions.clear();
    catalog.forEach((category) => categoryVersions.set(category.id, 0));
    if (!catalog.some((category) => category.id === selectedCategoryId)) selectedCategoryId = catalog[0]?.id || null;
    const category = selectedCategory();
    if (!category?.blocks.some((block) => block.id === selectedBlockId)) selectedBlockId = null;
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

  addCategoryButton.addEventListener("click", async () => {
    const id = uniqueId("new-category", new Set(catalog.map((category) => category.id)));
    const draft = {
      id,
      name: messages.settings.newCategoryName,
      description: messages.settings.newCategoryDescription,
      color: CATEGORY_COLORS[catalog.length % CATEGORY_COLORS.length],
      blocks: []
    };
    operationBusy = true;
    renderForm();
    setStatus(messages.settings.saving, "saving");
    try {
      const { category } = await createCategory(draft);
      catalog.push(category);
      categoryVersions.set(category.id, 0);
      selectedCategoryId = category.id;
      selectedBlockId = null;
      publishCatalog();
      renderEditor();
      categoryList.querySelector(`[data-category="${category.id}"]`)?.animate(
        [{ opacity: 0, transform: "translateY(-8px) scale(.96)" }, { opacity: 1, transform: "translateY(0) scale(1)" }],
        { duration: 300, easing: "cubic-bezier(.22, 1, .36, 1)" }
      );
      setStatus(messages.settings.saved, "saved");
      form.elements.categoryName.focus();
      form.elements.categoryName.select();
    } catch (error) {
      setStatus(interpolate(messages.settings.saveFailed, { message: error.message }), "error");
    } finally {
      operationBusy = false;
      renderForm();
    }
  });

  addBlockButton.addEventListener("click", async () => {
    const initialCategory = selectedCategory();
    if (!initialCategory) return;
    operationBusy = true;
    renderForm();
    cancelScheduledSave(initialCategory.id);
    await waitForCategoryIdle(initialCategory.id);
    const category = selectedCategory();
    if (!category || category.id !== initialCategory.id) {
      operationBusy = false;
      renderForm();
      return;
    }
    const snapshot = structuredClone(category);
    const id = uniqueId("new-block", new Set(category.blocks.map((block) => block.id)));
    const block = {
      id,
      type: category.id === "roles" ? "role" : "instruction",
      name: messages.settings.newBlockName,
      summary: messages.settings.newBlockSummary,
      icon: messages.settings.newBlockIcon,
      prompt: messages.settings.newBlockPrompt
    };
    category.blocks.push(block);
    selectedBlockId = block.id;
    renderEditor();
    setStatus(messages.settings.saving, "saving");
    try {
      const { category: saved } = await saveCategory(category);
      const index = catalog.findIndex((item) => item.id === category.id);
      catalog[index] = { ...saved, color: category.color };
      categoryVersions.set(category.id, 0);
      publishCatalog();
      renderEditor();
      blockList.querySelector(`[data-block="${block.id}"]`)?.animate(
        [{ opacity: 0, transform: "translateY(-8px) scale(.96)" }, { opacity: 1, transform: "translateY(0) scale(1)" }],
        { duration: 300, easing: "cubic-bezier(.22, 1, .36, 1)" }
      );
      setStatus(messages.settings.saved, "saved");
      form.elements.name.focus();
      form.elements.name.select();
    } catch (error) {
      const index = catalog.findIndex((item) => item.id === category.id);
      catalog[index] = snapshot;
      selectedBlockId = null;
      renderEditor();
      setStatus(interpolate(messages.settings.saveFailed, { message: error.message }), "error");
    } finally {
      operationBusy = false;
      renderForm();
    }
  });

  deleteBlockButton.addEventListener("click", async () => {
    const initialCategory = selectedCategory();
    const initialBlock = selectedBlock();
    if (!initialCategory || !initialBlock || !window.confirm(interpolate(messages.settings.confirmDeleteBlock, { name: initialBlock.name }))) return;
    operationBusy = true;
    renderForm();
    cancelScheduledSave(initialCategory.id);
    await waitForCategoryIdle(initialCategory.id);
    const category = selectedCategory();
    const block = category?.blocks.find((item) => item.id === initialBlock.id);
    if (!category || category.id !== initialCategory.id || !block) {
      operationBusy = false;
      renderForm();
      return;
    }
    const snapshot = structuredClone(category);
    const blockIndex = category.blocks.findIndex((item) => item.id === block.id);
    await animateRemoval(blockList.querySelector(`[data-block="${block.id}"]`));
    category.blocks.splice(blockIndex, 1);
    selectedBlockId = null;
    renderEditor();
    setStatus(messages.settings.saving, "saving");
    try {
      const { category: saved } = await saveCategory(category);
      const index = catalog.findIndex((item) => item.id === category.id);
      catalog[index] = { ...saved, color: category.color };
      categoryVersions.set(category.id, 0);
      publishCatalog();
      renderEditor();
      setStatus(messages.settings.saved, "saved");
    } catch (error) {
      const index = catalog.findIndex((item) => item.id === category.id);
      catalog[index] = snapshot;
      selectedBlockId = block.id;
      renderEditor();
      setStatus(interpolate(messages.settings.saveFailed, { message: error.message }), "error");
    } finally {
      operationBusy = false;
      renderForm();
    }
  });

  deleteCategoryButton.addEventListener("click", async () => {
    const category = selectedCategory();
    if (!category || !window.confirm(interpolate(messages.settings.confirmDeleteCategory, { name: category.name, count: category.blocks.length }))) return;
    operationBusy = true;
    deletedCategories.add(category.id);
    cancelScheduledSave(category.id);
    renderForm();
    await waitForCategoryIdle(category.id);
    await animateRemoval(categoryList.querySelector(`[data-category="${category.id}"]`));
    setStatus(messages.settings.saving, "saving");
    try {
      await deleteCategory(category.id);
      const index = catalog.findIndex((item) => item.id === category.id);
      catalog.splice(index, 1);
      categoryVersions.delete(category.id);
      selectedCategoryId = catalog[index]?.id || catalog[index - 1]?.id || null;
      selectedBlockId = null;
      publishCatalog();
      renderEditor();
      setStatus(messages.settings.saved, "saved");
    } catch (error) {
      deletedCategories.delete(category.id);
      renderEditor();
      setStatus(interpolate(messages.settings.saveFailed, { message: error.message }), "error");
    } finally {
      operationBusy = false;
      renderForm();
    }
  });

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
    if (!button || operationBusy) return;
    selectedCategoryId = button.dataset.category;
    selectedBlockId = null;
    renderEditor();
  });
  blockList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-block]");
    if (!button || operationBusy) return;
    selectedBlockId = selectedBlockId === button.dataset.block ? null : button.dataset.block;
    renderEditor();
  });
  form.addEventListener("input", () => {
    const category = selectedCategory();
    const block = selectedBlock();
    if (!category || !form.checkValidity()) return;
    if (block) {
      block.name = form.elements.name.value;
      block.icon = form.elements.icon.value;
      block.summary = form.elements.summary.value;
      block.type = form.elements.type.value;
      block.prompt = form.elements.prompt.value;
    } else {
      category.name = form.elements.categoryName.value;
      category.description = form.elements.categoryDescription.value;
      category.color = form.elements.categoryColor.value;
    }
    categoryVersions.set(category.id, (categoryVersions.get(category.id) || 0) + 1);
    renderCategories();
    renderBlocks();
    scheduleSave(category.id);
  });
  form.addEventListener("submit", (event) => event.preventDefault());

  renderLocale();
  renderEditor();
}
