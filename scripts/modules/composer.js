import { escapeHtml, icon, interpolate } from "../utils/dom.js?v=20260730.3";

const MOTION = { duration: 360, easing: "cubic-bezier(.22, 1, .36, 1)" };
const REMOVAL_STYLE_PROPERTIES = [
  "background-color", "color", "box-shadow", "display", "visibility",
  "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
  "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  "border-top-left-radius", "border-top-right-radius",
  "border-bottom-right-radius", "border-bottom-left-radius",
  "padding-top", "padding-right", "padding-bottom", "padding-left"
];

export function initializeComposer({ store, messages, resolveBlock, onLimitReached }) {
  const canvas = document.querySelector("#composer-canvas");
  const stack = document.querySelector("#block-stack");
  const empty = document.querySelector("#empty-state");
  const elements = new Map();
  let draggedId = null;
  let dragCommitted = false;
  let suppressReconcile = false;
  let renderedBlocks = null;
  let shellResizeAnimation = null;
  let userResizeAnimation = null;
  let slotTransitionFrame = null;

  stack.innerHTML = `
    <section class="user-container">
      <div class="user-blocks"></div>
      <div class="user-inner">
        <section class="role-container">
          <div class="role-blocks"></div>
          <p class="role-placeholder">${escapeHtml(messages.composer.roleEmpty)}</p>
          <div class="role-inner is-empty">
            <p class="requirements-placeholder">${escapeHtml(messages.composer.requirementsEmpty)}</p>
            <div class="requirement-blocks"></div>
          </div>
          <div class="role-slot" aria-hidden="true"></div>
        </section>
      </div>
    </section>
  `;
  const userContainer = stack.querySelector(".user-container");
  const userBlocks = stack.querySelector(".user-blocks");
  const roleContainer = stack.querySelector(".role-container");
  const roleBlocks = stack.querySelector(".role-blocks");
  const requirementBlocks = stack.querySelector(".requirement-blocks");
  const rolePlaceholder = stack.querySelector(".role-placeholder");
  const requirementsPlaceholder = stack.querySelector(".requirements-placeholder");
  const roleInner = stack.querySelector(".role-inner");
  const roleSlot = stack.querySelector(".role-slot");

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
          <span class="block-emphasis" hidden></span>
          <span class="block-controls">
            <button class="block-control" type="button" data-action="remove">${icon("trash")}</button>
          </span>
        </div>
        <div class="block-editor"><textarea data-action="edit"></textarea></div>
      </article>
    `;
    return template.content.firstElementChild;
  };

  const updateBlockElement = (element, block, index, joinsPrevious, joinsNext) => {
    const wasEmphasized = element.dataset.emphasized === "true";
    const wasDragging = element.classList.contains("dragging");
    element.dataset.instance = block.instanceId;
    element.dataset.category = block.categoryId;
    element.className = [
      "prompt-block",
      `type-${block.type}`,
      wasDragging ? "dragging" : "",
      joinsPrevious ? "joins-previous" : "",
      joinsNext ? "joins-next" : ""
    ].filter(Boolean).join(" " );
    element.style.setProperty("--block-color", block.color);
    element.draggable = block.type !== "user";
    element.querySelector(".block-order").textContent = String(index + 1).padStart(2, "0");
    element.querySelector(".block-title").textContent = block.name;
    const emphasis = element.querySelector(".block-emphasis");
    emphasis.hidden = !block.emphasized;
    emphasis.textContent = messages.composer.emphasis;
    element.classList.toggle("is-emphasized", Boolean(block.emphasized));
    element.dataset.emphasized = String(Boolean(block.emphasized));
    if (!wasEmphasized && block.emphasized) {
      element.animate(
        [
          { transform: "scale(1)", filter: "saturate(1)", boxShadow: `0 0 0 0 ${block.color}` },
          { transform: "scale(1.012)", filter: "saturate(1.18)", boxShadow: `0 0 0 7px ${block.color}55`, offset: .48 },
          { transform: "scale(1)", filter: "saturate(1)", boxShadow: `0 0 0 12px ${block.color}00` }
        ],
        { duration: 760, easing: "cubic-bezier(.16, 1, .3, 1)" }
      );
      emphasis.animate(
        [
          { opacity: 0, transform: "translateY(4px) scale(.55)", filter: "blur(3px)" },
          { opacity: 1, transform: "translateY(0) scale(1.16)", filter: "blur(0)", offset: .52 },
          { opacity: 1, transform: "translateY(0) scale(.96)", filter: "blur(0)", offset: .72 },
          { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0)" }
        ],
        { duration: 760, easing: "cubic-bezier(.16, 1, .3, 1)" }
      );
    }
    const textarea = element.querySelector("textarea");
    textarea.ariaLabel = interpolate(messages.composer.contentLabel, { name: block.name });
    if (document.activeElement !== textarea && textarea.value !== block.content) textarea.value = block.content;
    const remove = element.querySelector('[data-action="remove"]');
    remove.ariaLabel = interpolate(messages.composer.remove, { name: block.name });
  };

  const freezeRemovalAppearance = (source, ghost) => {
    const sourceNodes = [source, ...source.querySelectorAll("*")];
    const ghostNodes = [ghost, ...ghost.querySelectorAll("*")];
    sourceNodes.forEach((sourceNode, index) => {
      const style = getComputedStyle(sourceNode);
      const ghostNode = ghostNodes[index];
      if (!ghostNode) return;
      REMOVAL_STYLE_PROPERTIES.forEach((property) => {
        ghostNode.style.setProperty(property, style.getPropertyValue(property));
      });
    });
  };

  const reconcile = (state) => {
    if (suppressReconcile || state.blocks === renderedBlocks) return;
    renderedBlocks = state.blocks;
    const oldShellHeight = roleContainer.getBoundingClientRect().height;
    const oldUserHeight = userContainer.getBoundingClientRect().height;
    const hadUser = userContainer.classList.contains("has-user");
    const oldSlotStyle = getComputedStyle(roleSlot);
    const oldSlotState = {
      height: oldSlotStyle.height,
      marginTop: oldSlotStyle.marginTop,
      opacity: oldSlotStyle.opacity,
      transform: oldSlotStyle.transform
    };
    const wasSlotVisible = roleSlot.classList.contains("is-visible");
    shellResizeAnimation?.cancel();
    shellResizeAnimation = null;
    userResizeAnimation?.cancel();
    userResizeAnimation = null;
    if (slotTransitionFrame !== null) {
      window.cancelAnimationFrame(slotTransitionFrame);
      slotTransitionFrame = null;
    }
    roleSlot.getAnimations().forEach((animation) => animation.cancel());
    roleSlot.style.transition = "none";
    roleSlot.style.removeProperty("height");
    roleSlot.style.removeProperty("margin-top");
    roleSlot.style.removeProperty("opacity");
    roleSlot.style.removeProperty("transform");
    roleContainer.style.removeProperty("height");
    roleContainer.classList.remove("resizing");
    userContainer.style.removeProperty("height");
    userContainer.classList.remove("resizing");
    const oldPositions = new Map([...elements].map(([id, element]) => [id, element.getBoundingClientRect()]));
    const users = state.blocks.filter((block) => block.type === "user");
    const roles = state.blocks.filter((block) => block.type === "role");
    const requirements = state.blocks.filter((block) => block.type !== "role" && block.type !== "user");
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
      freezeRemovalAppearance(element, ghost);
      if (rect) {
        ghost.style.left = `${rect.left - canvasRect.left + canvas.scrollLeft}px`;
        ghost.style.top = `${rect.top - canvasRect.top + canvas.scrollTop}px`;
        ghost.style.width = `${rect.width}px`;
        ghost.style.height = `${rect.height}px`;
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
    const placeGroup = (container, blocks, group) => {
      blocks.forEach((block, groupIndex) => {
        let element = elements.get(block.instanceId);
        const isNew = !element;
        if (isNew) {
          element = createBlockElement();
          elements.set(block.instanceId, element);
        }
        const joinsPrevious = group === "requirement"
          && blocks[groupIndex - 1]?.categoryId === block.categoryId;
        const joinsNext = group === "requirement"
          && blocks[groupIndex + 1]?.categoryId === block.categoryId;
        updateBlockElement(
          element,
          block,
          state.blocks.indexOf(block),
          joinsPrevious,
          joinsNext
        );
        container.append(element);
        if (isNew) newElements.push(element);
        element.dataset.group = group;
      });
    };

    placeGroup(userBlocks, users, "user");
    placeGroup(roleBlocks, roles, "role");
    placeGroup(requirementBlocks, requirements, "requirement");
    userContainer.classList.toggle("has-user", users.length > 0);
    if (users[0]) userContainer.style.setProperty("--user-color", users[0].color);
    else userContainer.style.removeProperty("--user-color");
    roleContainer.classList.toggle("has-roles", roles.length > 0);
    roleInner.classList.toggle("is-empty", requirements.length === 0);
    const visibleBlocks = [...users, ...roles, ...requirements];
    visibleBlocks.forEach((block, index) => {
      elements.get(block.instanceId)?.querySelector(".block-order")?.replaceChildren(String(index + 1).padStart(2, "0"));
    });
    userContainer.getBoundingClientRect();
    const newElementSet = new Set(newElements);
    for (const block of visibleBlocks) {
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
    canvas.classList.toggle("has-blocks", state.blocks.length > 0);
    const isSlotVisible = roles.length > 0 && requirements.length === 0;
    roleSlot.classList.toggle("is-visible", isSlotVisible);
    rolePlaceholder.hidden = roles.length > 0;
    requirementsPlaceholder.hidden = requirements.length > 0;
    document.querySelector("#clear-button").disabled = state.blocks.length === 0;
    document.querySelector("#share-button").disabled = state.blocks.length === 0;
    updateEstimate(state.blocks);

    // Measure both shells while they are still at their natural post-reconcile sizes.
    // Locking the role shell first would make the outer user shell report the old
    // height and skip its own resize animation for tall compositions.
    const newShellHeight = roleContainer.getBoundingClientRect().height;
    const newUserHeight = userContainer.getBoundingClientRect().height;
    if (wasSlotVisible !== isSlotVisible) {
      roleSlot.style.height = oldSlotState.height;
      roleSlot.style.marginTop = oldSlotState.marginTop;
      roleSlot.style.opacity = oldSlotState.opacity;
      roleSlot.style.transform = oldSlotState.transform;
      roleSlot.getBoundingClientRect();
      roleSlot.style.removeProperty("transition");
      slotTransitionFrame = window.requestAnimationFrame(() => {
        slotTransitionFrame = null;
        roleSlot.style.removeProperty("height");
        roleSlot.style.removeProperty("margin-top");
        roleSlot.style.removeProperty("opacity");
        roleSlot.style.removeProperty("transform");
      });
    } else {
      roleSlot.style.removeProperty("transition");
    }
    if (oldShellHeight > 0 && Math.abs(oldShellHeight - newShellHeight) > 1) {
      roleContainer.classList.add("resizing");
      roleContainer.style.height = `${oldShellHeight}px`;
      shellResizeAnimation = roleContainer.animate(
        [{ height: `${oldShellHeight}px` }, { height: `${newShellHeight}px` }],
        MOTION
      );
      const currentAnimation = shellResizeAnimation;
      currentAnimation.finished.catch(() => {}).finally(() => {
        if (shellResizeAnimation !== currentAnimation) return;
        shellResizeAnimation = null;
        roleContainer.style.removeProperty("height");
        roleContainer.classList.remove("resizing");
      });
    }
    const hasUser = users.length > 0;
    if (oldUserHeight > 0 && (hadUser !== hasUser || Math.abs(oldUserHeight - newUserHeight) > 1)) {
      userContainer.classList.add("resizing");
      userContainer.style.height = `${oldUserHeight}px`;
      userResizeAnimation = userContainer.animate(
        [{ height: `${oldUserHeight}px` }, { height: `${newUserHeight}px` }],
        MOTION
      );
      const currentAnimation = userResizeAnimation;
      currentAnimation.finished.catch(() => {}).finally(() => {
        if (userResizeAnimation !== currentAnimation) return;
        userResizeAnimation = null;
        userContainer.style.removeProperty("height");
        userContainer.classList.remove("resizing");
      });
    }
  };

  const groupOrderFromDom = (container) => [...container.querySelectorAll(":scope > .prompt-block")]
    .map((element) => element.dataset.instance);

  const applyGroupOrder = (blocks, groupOrder, matchesGroup) => {
    const byId = new Map(blocks.map((block) => [block.instanceId, block]));
    let groupIndex = 0;
    return blocks.map((block) => {
      if (!matchesGroup(block)) return block;
      return byId.get(groupOrder[groupIndex++]) || block;
    });
  };

  const updateDragPreview = (container) => {
    const state = store.getState();
    const roleOrder = groupOrderFromDom(roleBlocks);
    const requirementOrder = groupOrderFromDom(requirementBlocks);
    const previewBlocks = applyGroupOrder(
      applyGroupOrder(state.blocks, roleOrder, (block) => block.type === "role"),
      requirementOrder,
      (block) => block.type !== "role" && block.type !== "user"
    );
    const userOrder = groupOrderFromDom(userBlocks);
    const visibleOrder = [...userOrder, ...roleOrder, ...requirementOrder];
    visibleOrder.forEach((instanceId, index) => {
      elements.get(instanceId)?.querySelector(".block-order")?.replaceChildren(String(index + 1).padStart(2, "0"));
    });
    if (container === requirementBlocks) {
      const previewRequirements = previewBlocks.filter((block) => block.type !== "role" && block.type !== "user");
      previewRequirements.forEach((block, index) => {
        const element = elements.get(block.instanceId);
        element?.classList.toggle("joins-previous", previewRequirements[index - 1]?.categoryId === block.categoryId);
        element?.classList.toggle("joins-next", previewRequirements[index + 1]?.categoryId === block.categoryId);
      });
    }
  };

  const restoreRenderedOrder = () => {
    renderedBlocks = null;
    reconcile(store.getState());
  };

  const clearDragVisualState = () => {
    canvas.classList.remove("drag-over");
    stack.querySelectorAll(".prompt-block.dragging").forEach((element) => element.classList.remove("dragging"));
  };

  const addBlock = (block) => {
    if (block.type === "user") {
      const existingUser = store.getState().blocks.find((item) => item.type === "user");
      if (existingUser) {
        onLimitReached?.(block);
        return false;
      }
    }
    const sourceKey = `${block.categoryId}:${block.id}`;
    const existing = store.getState().blocks.find(
      (item) => `${item.categoryId}:${item.sourceId}` === sourceKey
    );
    if (existing?.emphasized) {
      onLimitReached?.(block);
      return false;
    }
    store.setState((state) => {
      const current = state.blocks.find((item) => `${item.categoryId}:${item.sourceId}` === sourceKey);
      if (current && block.type !== "user") {
        return { blocks: state.blocks.map((item) => item.instanceId === current.instanceId ? { ...item, emphasized: true } : item) };
      }
      const instance = {
        instanceId: crypto.randomUUID(), sourceId: block.id, name: block.name, type: block.type,
        categoryId: block.categoryId, categoryName: block.categoryName, color: block.color,
        sourcePrompt: block.prompt, content: block.prompt, emphasized: false
      };
      return { blocks: block.type === "user" ? [instance, ...state.blocks] : [...state.blocks, instance] };
    });
    window.requestAnimationFrame(() => {
      canvas.scrollTo({ top: canvas.scrollHeight, behavior: "smooth" });
      if (block.type === "user") {
        const instance = store.getState().blocks.find((item) => `${item.categoryId}:${item.sourceId}` === sourceKey);
        focusBlock(instance?.instanceId);
      }
    });
    return true;
  };

  const focusBlock = (instanceId) => {
    const textarea = elements.get(instanceId)?.querySelector("textarea");
    textarea?.focus();
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
    if (!article || article.dataset.group === "user") {
      event.preventDefault();
      return;
    }
    draggedId = article.dataset.instance;
    dragCommitted = false;
    article.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
  });
  stack.addEventListener("dragend", (event) => {
    event.target.closest(".prompt-block")?.classList.remove("dragging");
    if (!dragCommitted && draggedId) restoreRenderedOrder();
    clearDragVisualState();
    draggedId = null;
    dragCommitted = false;
  });
  stack.addEventListener("dragover", (event) => {
    if (!draggedId) return;
    const source = elements.get(draggedId);
    const target = event.target.closest(".prompt-block");
    if (!source || !target || source === target || source.parentElement !== target.parentElement) return;
    event.preventDefault();
    const container = target.parentElement;
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const oldPositions = new Map(
      [...container.querySelectorAll(":scope > .prompt-block")].map((element) => [element, element.getBoundingClientRect()])
    );
    if (event.clientY < targetRect.top + targetRect.height / 2) target.before(source);
    else target.after(source);
    if (sourceRect.top === source.getBoundingClientRect().top) return;
    updateDragPreview(container);
    for (const [element, oldRect] of oldPositions) {
      if (element === source) continue;
      const nextRect = element.getBoundingClientRect();
      const offset = oldRect.top - nextRect.top;
      if (Math.abs(offset) > 1) {
        element.animate(
          [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }],
          { duration: 180, easing: MOTION.easing }
        );
      }
    }
  });
  stack.addEventListener("drop", (event) => {
    const sourceElement = draggedId ? elements.get(draggedId) : null;
    if (!sourceElement) return;
    event.preventDefault();
    event.stopPropagation();
    const matchesGroup = sourceElement.parentElement === roleBlocks
      ? (block) => block.type === "role"
      : (block) => block.type !== "role" && block.type !== "user";
    const groupOrder = groupOrderFromDom(sourceElement.parentElement);
    dragCommitted = true;
    store.setState(({ blocks }) => {
      return { blocks: applyGroupOrder(blocks, groupOrder, matchesGroup) };
    });
    clearDragVisualState();
    draggedId = null;
  });
  canvas.addEventListener("dragover", (event) => { event.preventDefault(); canvas.classList.add("drag-over"); });
  canvas.addEventListener("dragleave", (event) => {
    if (!canvas.contains(event.relatedTarget)) canvas.classList.remove("drag-over");
  });
  canvas.addEventListener("drop", (event) => {
    event.preventDefault();
    clearDragVisualState();
    const value = event.dataTransfer.getData("application/x-promptpair-block");
    if (!value) return;
    try {
      const { category, block } = JSON.parse(value);
      const resolved = resolveBlock(category, block);
      if (resolved) addBlock(resolved);
    } catch { return; }
  });
  window.addEventListener("dragend", clearDragVisualState);
  window.addEventListener("drop", clearDragVisualState);

  store.subscribe(reconcile);
  reconcile(store.getState());
  return { addBlock, syncCatalog, focusBlock };
}
