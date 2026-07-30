import { escapeHtml, icon, interpolate } from "../utils/dom.js";

const MOTION = { duration: 360, easing: "cubic-bezier(.22, 1, .36, 1)" };

export function initializeComposer({ store, messages, resolveBlock, onLimitReached }) {
  const canvas = document.querySelector("#composer-canvas");
  const stack = document.querySelector("#block-stack");
  const empty = document.querySelector("#empty-state");
  const elements = new Map();
  let draggedId = null;
  let suppressReconcile = false;
  let renderedBlocks = null;

  stack.innerHTML = `
    <section class="role-container">
      <header class="role-container-heading">
        <strong></strong>
      </header>
      <div class="role-blocks"></div>
      <p class="role-placeholder">${escapeHtml(messages.composer.roleEmpty)}</p>
      <div class="role-inner is-empty">
        <p class="requirements-placeholder">${escapeHtml(messages.composer.requirementsEmpty)}</p>
        <div class="requirement-blocks"></div>
      </div>
    </section>
  `;
  const roleContainer = stack.querySelector(".role-container");
  const roleBlocks = stack.querySelector(".role-blocks");
  const requirementBlocks = stack.querySelector(".requirement-blocks");
  const rolePlaceholder = stack.querySelector(".role-placeholder");
  const requirementsPlaceholder = stack.querySelector(".requirements-placeholder");
  const roleCount = stack.querySelector(".role-container-heading strong");
  const roleInner = stack.querySelector(".role-inner");

  const updateEstimate = (blocks) => {
    const characters = blocks.reduce((sum, block) => sum + block.content.length, 0);
    document.querySelector("#token-estimate").textContent = interpolate(messages.generate.estimate, {
      tokens: Math.ceil(characters / 2.2),
      blocks: blocks.length
    });
  };

  const createBlockElement = () => {
    const template = document.createElement("template");
    template.innerHTML = `
      <article class="prompt-block" draggable="true">
        <div class="block-header">
          <span class="drag-handle" aria-hidden="true">⠿</span>
          <span class="block-order"></span>
          <strong class="block-title"></strong>
          <span class="block-type"></span>
          <span class="block-category"></span>
          <span class="block-emphasis" hidden></span>
          <span class="block-controls">
            <button class="block-control" type="button" data-action="up">${icon("arrowUp")}</button>
            <button class="block-control" type="button" data-action="down">${icon("arrowDown")}</button>
            <button class="block-control" type="button" data-action="remove">${icon("trash")}</button>
          </span>
        </div>
        <div class="block-editor"><textarea data-action="edit"></textarea></div>
      </article>
    `;
    return template.content.firstElementChild;
  };

  const updateBlockElement = (element, block, index, groupIndex, groupLength, occurrenceCount) => {
    element.dataset.instance = block.instanceId;
    element.className = `prompt-block type-${block.type}${element.classList.contains("dragging") ? " dragging" : ""}`;
    element.style.setProperty("--block-color", block.color);
    element.querySelector(".block-order").textContent = String(index + 1).padStart(2, "0");
    element.querySelector(".block-title").textContent = block.name;
    element.querySelector(".block-type").textContent = messages.types[block.type] || block.type;
    element.querySelector(".block-category").textContent = block.categoryName;
    const emphasis = element.querySelector(".block-emphasis");
    emphasis.hidden = occurrenceCount !== 2;
    emphasis.textContent = messages.composer.emphasis;
    element.classList.toggle("is-emphasized", occurrenceCount === 2);
    const textarea = element.querySelector("textarea");
    textarea.ariaLabel = interpolate(messages.composer.contentLabel, { name: block.name });
    if (document.activeElement !== textarea && textarea.value !== block.content) textarea.value = block.content;
    const up = element.querySelector('[data-action="up"]');
    const down = element.querySelector('[data-action="down"]');
    const remove = element.querySelector('[data-action="remove"]');
    up.disabled = groupIndex === 0;
    down.disabled = groupIndex === groupLength - 1;
    up.ariaLabel = interpolate(messages.composer.moveUp, { name: block.name });
    down.ariaLabel = interpolate(messages.composer.moveDown, { name: block.name });
    remove.ariaLabel = interpolate(messages.composer.remove, { name: block.name });
  };

  const reconcile = (state) => {
    if (suppressReconcile || state.blocks === renderedBlocks) return;
    renderedBlocks = state.blocks;
    const oldShellHeight = roleContainer.getBoundingClientRect().height;
    const oldPositions = new Map([...elements].map(([id, element]) => [id, element.getBoundingClientRect()]));
    const roles = state.blocks.filter((block) => block.type === "role");
    const requirements = state.blocks.filter((block) => block.type !== "role");
    const activeIds = new Set(state.blocks.map((block) => block.instanceId));

    for (const [id, element] of elements) {
      if (activeIds.has(id)) continue;
      elements.delete(id);
      const rect = oldPositions.get(id);
      const canvasRect = canvas.getBoundingClientRect();
      const ghost = element.cloneNode(true);
      ghost.removeAttribute("data-instance");
      ghost.dataset.removing = "true";
      ghost.classList.add("block-removal-ghost");
      if (rect) {
        ghost.style.left = `${rect.left - canvasRect.left + canvas.scrollLeft}px`;
        ghost.style.top = `${rect.top - canvasRect.top + canvas.scrollTop}px`;
        ghost.style.width = `${rect.width}px`;
      }
      element.remove();
      canvas.append(ghost);
      const animation = ghost.animate(
        [
          { opacity: 1, transform: "translateX(0) scale(1)" },
          { opacity: 0, transform: "translateX(24px) scale(.86)" }
        ],
        { ...MOTION, duration: 220, fill: "forwards" }
      );
      animation.finished.catch(() => {}).finally(() => ghost.remove());
    }

    const newElements = [];
    const occurrenceCounts = new Map();
    state.blocks.forEach((block) => {
      const key = `${block.categoryId}:${block.sourceId}`;
      occurrenceCounts.set(key, (occurrenceCounts.get(key) || 0) + 1);
    });
    const placeGroup = (container, blocks, group) => {
      blocks.forEach((block, groupIndex) => {
        let element = elements.get(block.instanceId);
        const isNew = !element;
        if (isNew) {
          element = createBlockElement();
          elements.set(block.instanceId, element);
        }
        updateBlockElement(
          element,
          block,
          state.blocks.indexOf(block),
          groupIndex,
          blocks.length,
          occurrenceCounts.get(`${block.categoryId}:${block.sourceId}`)
        );
        container.append(element);
        if (isNew) newElements.push(element);
        element.dataset.group = group;
      });
    };

    placeGroup(roleBlocks, roles, "role");
    placeGroup(requirementBlocks, requirements, "requirement");
    const newElementSet = new Set(newElements);
    for (const block of state.blocks) {
      const element = elements.get(block.instanceId);
      if (newElementSet.has(element)) {
        element.animate(
          [{ transform: "translateY(16px) scale(.96)" }, { transform: "translateY(0) scale(1)" }],
          MOTION
        );
        continue;
      }
      const previous = oldPositions.get(block.instanceId);
      const current = element.getBoundingClientRect();
      if (!previous) continue;
      const x = previous.left - current.left;
      const y = previous.top - current.top;
      if (Math.abs(x) > 1 || Math.abs(y) > 1) {
        element.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "translate(0, 0)" }], MOTION);
      }
    }
    empty.hidden = state.blocks.length > 0;
    stack.hidden = state.blocks.length === 0;
    roleContainer.classList.toggle("has-roles", roles.length > 0);
    roleInner.classList.toggle("is-empty", requirements.length === 0);
    rolePlaceholder.hidden = roles.length > 0;
    requirementsPlaceholder.hidden = requirements.length > 0;
    roleCount.textContent = interpolate(messages.composer.roleCount, { count: roles.length });
    document.querySelector("#clear-button").disabled = state.blocks.length === 0;
    document.querySelector("#share-button").disabled = state.blocks.length === 0;
    updateEstimate(state.blocks);

    const newShellHeight = roleContainer.getBoundingClientRect().height;
    if (oldShellHeight > 0 && Math.abs(oldShellHeight - newShellHeight) > 1) {
      roleContainer.classList.add("resizing");
      const animation = roleContainer.animate(
        [{ height: `${oldShellHeight}px` }, { height: `${newShellHeight}px` }],
        MOTION
      );
      animation.finished.catch(() => {}).finally(() => roleContainer.classList.remove("resizing"));
    }
  };

  const move = (instanceId, direction) => {
    store.setState((state) => {
      const from = state.blocks.findIndex((block) => block.instanceId === instanceId);
      if (from < 0) return state;
      const roleGroup = state.blocks[from].type === "role";
      const eligible = state.blocks.map((block, index) => ({ block, index })).filter(({ block }) => (block.type === "role") === roleGroup);
      const groupIndex = eligible.findIndex(({ index }) => index === from);
      const target = eligible[groupIndex + direction];
      if (!target) return state;
      const blocks = [...state.blocks];
      [blocks[from], blocks[target.index]] = [blocks[target.index], blocks[from]];
      return { blocks };
    });
  };

  const addBlock = (block) => {
    const sourceKey = `${block.categoryId}:${block.id}`;
    const occurrenceCount = store.getState().blocks.filter(
      (item) => `${item.categoryId}:${item.sourceId}` === sourceKey
    ).length;
    if (occurrenceCount >= 2) {
      onLimitReached?.(block);
      return false;
    }
    store.setState((state) => ({ blocks: [...state.blocks, {
      instanceId: crypto.randomUUID(), sourceId: block.id, name: block.name, type: block.type,
      categoryId: block.categoryId, categoryName: block.categoryName, color: block.color,
      sourcePrompt: block.prompt, content: block.prompt
    }] }));
    window.requestAnimationFrame(() => canvas.scrollTo({ top: canvas.scrollHeight, behavior: "smooth" }));
    return true;
  };

  const syncCatalog = () => {
    store.setState((state) => ({
      blocks: state.blocks.flatMap((block) => {
        const source = resolveBlock(block.categoryId, block.sourceId);
        if (!source) return [];
        const userEdited = block.content !== block.sourcePrompt;
        return [{ ...block, name: source.name, type: source.type, categoryName: source.categoryName, color: source.color,
          sourcePrompt: source.prompt, content: userEdited ? block.content : source.prompt }];
      })
    }));
  };

  stack.addEventListener("click", (event) => {
    const control = event.target.closest("[data-action]");
    const article = event.target.closest(".prompt-block");
    if (!control || !article || control.dataset.action === "edit") return;
    const instanceId = article.dataset.instance;
    if (control.dataset.action === "up") move(instanceId, -1);
    if (control.dataset.action === "down") move(instanceId, 1);
    if (control.dataset.action === "remove") store.setState((state) => ({ blocks: state.blocks.filter((block) => block.instanceId !== instanceId) }));
  });
  stack.addEventListener("input", (event) => {
    if (event.target.dataset.action !== "edit") return;
    const instanceId = event.target.closest(".prompt-block").dataset.instance;
    suppressReconcile = true;
    store.setState((state) => ({ blocks: state.blocks.map((block) => block.instanceId === instanceId ? { ...block, content: event.target.value } : block) }));
    suppressReconcile = false;
    renderedBlocks = store.getState().blocks;
    updateEstimate(renderedBlocks);
  });
  stack.addEventListener("dragstart", (event) => {
    const article = event.target.closest(".prompt-block");
    if (!article) return;
    draggedId = article.dataset.instance;
    article.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
  });
  stack.addEventListener("dragend", (event) => { event.target.closest(".prompt-block")?.classList.remove("dragging"); draggedId = null; });
  stack.addEventListener("dragover", (event) => { if (draggedId !== null && event.target.closest(".prompt-block")) event.preventDefault(); });
  stack.addEventListener("drop", (event) => {
    const target = event.target.closest(".prompt-block");
    if (!draggedId || !target || draggedId === target.dataset.instance) return;
    event.preventDefault();
    const state = store.getState();
    const source = state.blocks.find((block) => block.instanceId === draggedId);
    const destination = state.blocks.find((block) => block.instanceId === target.dataset.instance);
    if (!source || !destination || (source.type === "role") !== (destination.type === "role")) return;
    store.setState(({ blocks }) => {
      const next = [...blocks];
      const from = next.findIndex((block) => block.instanceId === draggedId);
      const to = next.findIndex((block) => block.instanceId === target.dataset.instance);
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return { blocks: next };
    });
    draggedId = null;
  });
  canvas.addEventListener("dragover", (event) => { event.preventDefault(); canvas.classList.add("drag-over"); });
  canvas.addEventListener("dragleave", (event) => { if (!canvas.contains(event.relatedTarget)) canvas.classList.remove("drag-over"); });
  canvas.addEventListener("drop", (event) => {
    event.preventDefault();
    canvas.classList.remove("drag-over");
    const value = event.dataTransfer.getData("application/x-promptpair-block");
    if (!value) return;
    try {
      const { category, block } = JSON.parse(value);
      const resolved = resolveBlock(category, block);
      if (resolved) addBlock(resolved);
    } catch { return; }
  });

  store.subscribe(reconcile);
  reconcile(store.getState());
  return { addBlock, syncCatalog };
}
