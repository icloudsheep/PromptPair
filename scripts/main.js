import { createStore } from "./core/store.js";
import { loadApplication } from "./services/config-service.js";
import { generatePrompt, getModelStatus } from "./services/api-service.js";
import { initializeTheme } from "./modules/theme.js";
import { initializeLibrary } from "./modules/library.js";
import { initializeComposer } from "./modules/composer.js";
import { initializeSettings } from "./modules/settings.js";
import { parseRecipe, serializeRecipe } from "./modules/sharing.js";
import { applyMessages, icon, interpolate, showToast } from "./utils/dom.js";
import { renderMarkdown } from "./utils/markdown.js";

async function copyText(value, messages) {
  try { await navigator.clipboard.writeText(value); return true; }
  catch { showToast(messages.errors.clipboardFailed, "error"); return false; }
}

async function start() {
  const { app, messages, categories } = await loadApplication();
  document.title = messages.app.pageTitle;
  document.documentElement.lang = app.locale;
  applyMessages(messages);
  initializeTheme(app.defaultTheme, messages);
  document.querySelector(".brand").ariaLabel = messages.app.name;
  document.querySelector("#search-icon").innerHTML = icon("search");
  document.querySelector("#result-icon").innerHTML = icon("spark");
  document.querySelector("#composer-canvas").ariaLabel = messages.composer.dropLabel;

  const repoLink = document.querySelector("#repo-link");
  repoLink.href = app.repositoryUrl || "/README.md";
  repoLink.textContent = messages.app.about;
  repoLink.ariaLabel = messages.app.about;

  const store = createStore({ blocks: [], result: "", generating: false });
  let composer;
  const limitReached = () => showToast(messages.library.limitReached, "error");
  const library = initializeLibrary({
    categories,
    messages,
    store,
    onAdd: (block) => composer.addBlock(block)
  });
  composer = initializeComposer({ store, messages, resolveBlock: library.resolve, onLimitReached: limitReached });
  initializeSettings({
    app,
    messages,
    categories,
    onCatalogChange(nextCategories) {
      library.updateCategories(nextCategories);
      composer.syncCatalog();
    }
  });

  const status = document.querySelector("#model-status");
  status.querySelector("span").textContent = messages.status.checking;
  try {
    const health = await getModelStatus();
    status.classList.toggle("offline", !health.modelConfigured);
    status.querySelector("span").textContent = health.modelConfigured ? `${messages.status.connected} · ${health.model}` : messages.status.notConfigured;
  } catch { status.classList.add("offline"); status.querySelector("span").textContent = messages.status.notConfigured; }

  const generateButton = document.querySelector("#generate-button");
  const copyButton = document.querySelector("#copy-button");
  const resultPanel = document.querySelector(".result-panel");
  const resultClose = document.querySelector("#result-close");
  const result = document.querySelector("#result-content");
  const placeholder = document.querySelector("#result-placeholder");
  resultClose.innerHTML = icon("close");
  resultClose.ariaLabel = messages.result.close;
  resultClose.addEventListener("click", () => resultPanel.classList.remove("open"));
  const renderGenerate = (state) => {
    generateButton.disabled = state.generating || state.blocks.length === 0;
    generateButton.classList.toggle("loading", state.generating);
    generateButton.innerHTML = `${icon(state.generating ? "loader" : "wand")}<span>${state.generating ? messages.generate.generating : messages.generate.button}</span>`;
    copyButton.disabled = !state.result; copyButton.textContent = messages.result.copy;
    renderMarkdown(result, state.result);
    result.hidden = !state.result;
    placeholder.hidden = Boolean(state.result);
    placeholder.querySelector("p").textContent = state.generating ? messages.result.streaming : messages.result.placeholder;
    placeholder.classList.toggle("streaming", state.generating && !state.result);
  };
  store.subscribe(renderGenerate);
  renderGenerate(store.getState());

  generateButton.addEventListener("click", async () => {
    const { blocks } = store.getState();
    if (!blocks.length) { showToast(messages.generate.emptyError, "error"); return; }
    store.setState({ result: "", generating: true });
    resultPanel.classList.add("open");
    try {
      const response = await generatePrompt(blocks, {
        onDelta: (_delta, content) => store.setState({ result: content })
      });
      store.setState({ result: response.content, generating: false });
      showToast(messages.generate.success);
    } catch (error) {
      store.setState({ generating: false });
      showToast(interpolate(messages.generate.failed, { message: error.message }), "error");
    }
  });
  copyButton.addEventListener("click", async () => {
    if (await copyText(store.getState().result, messages)) { copyButton.textContent = messages.result.copied; showToast(messages.result.copySuccess); }
  });
  document.querySelector("#clear-button").addEventListener("click", () => {
    store.setState({ blocks: [], result: "" });
  });

  const shareButton = document.querySelector("#share-button");
  const recipeDialog = document.querySelector("#recipe-dialog");
  const recipeCode = document.querySelector("#recipe-code");
  const recipeClose = document.querySelector("#recipe-dialog-close");
  const recipeCopy = document.querySelector("#recipe-copy");
  const recipeApply = document.querySelector("#recipe-apply");
  shareButton.innerHTML = `${icon("share")}<span>${messages.actions.share}</span>`;
  shareButton.hidden = !app.sharing.enabled;
  recipeClose.innerHTML = icon("close");
  recipeClose.ariaLabel = messages.sharing.close;
  const closeRecipeDialog = () => {
    if (!recipeDialog.open || recipeDialog.dataset.closing === "true") return;
    recipeDialog.dataset.closing = "true";
    const card = recipeDialog.querySelector(".recipe-dialog-card");
    const animation = card.animate(
      [
        { transform: "translateY(0) scale(1)" },
        { transform: "translateY(18px) scale(.94)" }
      ],
      { duration: 180, easing: "cubic-bezier(.55, 0, 1, .45)" }
    );
    animation.finished.finally(() => {
      recipeDialog.close();
      delete recipeDialog.dataset.closing;
    });
  };
  shareButton.addEventListener("click", () => {
    recipeCode.value = serializeRecipe(store.getState().blocks);
    recipeDialog.showModal();
    recipeDialog.querySelector(".recipe-dialog-card").animate(
      [
        { transform: "translateY(20px) scale(.94)" },
        { transform: "translateY(0) scale(1)" }
      ],
      { duration: 320, easing: "cubic-bezier(.22, 1, .36, 1)" }
    );
    recipeCode.focus();
  });
  recipeClose.addEventListener("click", closeRecipeDialog);
  recipeDialog.addEventListener("cancel", (event) => { event.preventDefault(); closeRecipeDialog(); });
  recipeDialog.addEventListener("click", (event) => { if (event.target === recipeDialog) closeRecipeDialog(); });
  recipeCopy.addEventListener("click", async () => {
    if (await copyText(recipeCode.value, messages)) showToast(messages.sharing.copySuccess);
  });
  recipeApply.addEventListener("click", () => {
    try {
      const blocks = parseRecipe(recipeCode.value, library.resolve);
      store.setState({ blocks, result: "" });
      closeRecipeDialog();
      showToast(messages.sharing.applySuccess);
    } catch {
      showToast(messages.errors.invalidRecipe, "error");
      recipeCode.focus();
    }
  });
}

start().catch((error) => {
  console.error(error);
  const region = document.querySelector("#toast-region");
  const toast = document.createElement("div");
  toast.className = "toast error";
  toast.textContent = region.dataset.loadError;
  region.replaceChildren(toast);
});
