export function serializeRecipe(blocks) {
  const recipe = {
    version: 2,
    blocks: blocks.map(({ categoryId, sourceId, content, sourcePrompt, emphasized }) => {
      const item = { category: categoryId, block: sourceId, emphasized: Boolean(emphasized) };
      if (content !== sourcePrompt) item.content = content;
      return item;
    })
  };
  return JSON.stringify(recipe, null, 2);
}

export function parseRecipe(code, resolveBlock) {
  const data = JSON.parse(code.trim());
  if (data?.version !== 2 || !Array.isArray(data.blocks) || data.blocks.length > 50) {
    throw new Error("Invalid recipe");
  }
  const counts = new Map();
  let userCount = 0;
  return data.blocks.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid recipe block");
    const source = resolveBlock(item.category, item.block);
    if (!source || (item.content !== undefined && typeof item.content !== "string") || typeof item.emphasized !== "boolean") {
      throw new Error("Invalid recipe block");
    }
    const sourceKey = `${source.categoryId}:${source.id}`;
    if (counts.has(sourceKey)) throw new Error("Recipe block limit exceeded");
    if (source.type === "user" && (++userCount > 1 || item.emphasized)) {
      throw new Error("Only one non-emphasized user block is allowed");
    }
    counts.set(sourceKey, 1);
    return {
      instanceId: crypto.randomUUID(),
      sourceId: source.id,
      name: source.name,
      type: source.type,
      categoryId: source.categoryId,
      categoryName: source.categoryName,
      color: source.color,
      sourcePrompt: source.prompt,
      content: (item.content ?? source.prompt).slice(0, 12000),
      emphasized: item.emphasized
    };
  });
}
