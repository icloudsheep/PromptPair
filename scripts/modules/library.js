import { escapeHtml, interpolate } from "../utils/dom.js?v=20260730.2";

export function initializeLibrary({ categories, messages, store, onAdd }) {
  const tabs = document.querySelector("#category-tabs");
  const list = document.querySelector("#library-list");
  const search = document.querySelector("#prompt-search");
  const tooltip = document.querySelector("#library-tooltip");
  let catalog = categories;
  let activeCategory = "all";
  let usage = new Map();

  search.placeholder = messages.library.searchPlaceholder;
  tabs.ariaLabel = messages.library.categoryLabel;

  const updateCount = () => {
    document.querySelector("#block-count").textContent = catalog.reduce(
      (sum, category) => sum + category.blocks.length,
      0
    );
  };

  const renderTabs = () => {
    const items = [{ id: "all", name: messages.library.allCategories }, ...catalog];
    tabs.innerHTML = items.map(({ id, name }) => `
      <button class="category-tab ${activeCategory === id ? "active" : ""}" type="button" data-category="${escapeHtml(id)}">${escapeHtml(name)}</button>
    `).join("");
  };

  const renderList = () => {
    const query = search.value.trim().toLocaleLowerCase();
    const visible = catalog
      .filter((category) => activeCategory === "all" || category.id === activeCategory)
      .map((category) => ({
        ...category,
        blocks: category.blocks.filter((block) => {
          const typeName = messages.types[block.type] || block.type;
          return `${block.name} ${block.summary} ${block.prompt} ${typeName}`.toLocaleLowerCase().includes(query);
        })
      }))
      .filter((category) => category.blocks.length);

    if (!visible.length) {
      list.innerHTML = `<div class="no-results">${escapeHtml(messages.library.noResults)}</div>`;
      return;
    }

    list.innerHTML = visible.map((category) => `
      <section class="library-group">
        <h2 class="library-group-title" style="--block-color:${category.color}"><i></i>${escapeHtml(category.name)}</h2>
        ${category.blocks.map((block) => `
          <button class="library-card type-${escapeHtml(block.type)}" type="button" draggable="true" data-category="${escapeHtml(category.id)}" data-block="${escapeHtml(block.id)}" style="--block-color:${category.color}" aria-label="${escapeHtml(interpolate(messages.library.addBlock, { name: block.name }))}">
            <span class="card-icon">${escapeHtml(block.icon)}</span>
            <span class="card-copy">
              <span class="card-meta">${escapeHtml(messages.types[block.type] || block.type)}</span>
              <strong>${escapeHtml(block.name)}</strong>
              <span>${escapeHtml(block.summary)}</span>
            </span>
          </button>
        `).join("")}
      </section>
    `).join("");
    updateUsage();
  };

  const updateUsage = (blocks = store.getState().blocks) => {
    usage = new Map();
    blocks.forEach((block) => {
      const key = `${block.categoryId}:${block.sourceId}`;
      usage.set(key, block.emphasized ? 2 : 1);
    });
    list.querySelectorAll(".library-card").forEach((card) => {
      const count = usage.get(`${card.dataset.category}:${card.dataset.block}`) || 0;
      const emphasized = count === 2;
      card.disabled = emphasized;
      card.draggable = !emphasized;
      card.classList.toggle("is-depleted", emphasized);
      const block = resolve(card.dataset.category, card.dataset.block);
      card.ariaLabel = emphasized
        ? interpolate(messages.library.limitLabel, { name: block?.name || "" })
        : interpolate(messages.library.addBlock, { name: block?.name || "" });
      card.dataset.tooltip = emphasized
        ? interpolate(messages.library.limitLabel, { name: block?.name || "" })
        : `${block?.name || ""}\n${block?.summary || ""}`;
    });
  };

  const showTooltip = (card) => {
    if (!card?.dataset.tooltip) return;
    tooltip.textContent = card.dataset.tooltip;
    tooltip.hidden = false;
    const rect = card.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const left = Math.min(rect.right + 10, window.innerWidth - tooltipRect.width - 12);
    const top = Math.min(Math.max(12, rect.top + (rect.height - tooltipRect.height) / 2), window.innerHeight - tooltipRect.height - 12);
    tooltip.style.left = `${Math.max(12, left)}px`;
    tooltip.style.top = `${top}px`;
  };

  const hideTooltip = () => { tooltip.hidden = true; };

  const resolve = (categoryId, blockId) => {
    const category = catalog.find((item) => item.id === categoryId);
    const block = category?.blocks.find((item) => item.id === blockId);
    return block ? { ...block, categoryId: category.id, categoryName: category.name, color: category.color } : null;
  };

  const updateCategories = (nextCategories) => {
    catalog = nextCategories;
    if (activeCategory !== "all" && !catalog.some((category) => category.id === activeCategory)) {
      activeCategory = "all";
    }
    updateCount();
    renderTabs();
    renderList();
  };

  tabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    activeCategory = button.dataset.category;
    renderTabs();
    renderList();
  });
  list.addEventListener("click", (event) => {
    const card = event.target.closest(".library-card");
    if (card?.disabled) return;
    const block = card && resolve(card.dataset.category, card.dataset.block);
    if (block) onAdd(block);
  });
  list.addEventListener("dragstart", (event) => {
    const card = event.target.closest(".library-card");
    if (!card || card.disabled) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-promptpair-block", JSON.stringify({ category: card.dataset.category, block: card.dataset.block }));
  });
  list.addEventListener("pointerover", (event) => showTooltip(event.target.closest(".library-card")));
  list.addEventListener("pointerout", (event) => {
    const card = event.target.closest(".library-card");
    if (card && !card.contains(event.relatedTarget)) hideTooltip();
  });
  list.addEventListener("focusin", (event) => showTooltip(event.target.closest(".library-card")));
  list.addEventListener("focusout", hideTooltip);
  list.addEventListener("scroll", hideTooltip, { passive: true });
  search.addEventListener("input", renderList);
  store.subscribe((state) => updateUsage(state.blocks));
  window.addEventListener("keydown", (event) => {
    if (event.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      search.focus();
    }
  });

  updateCategories(catalog);
  return { resolve, updateCategories, updateUsage };
}
