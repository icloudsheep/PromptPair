export function serializeRecipe(blocks) {
  const recipe = {
    version: 1,
    blocks: blocks.map(({ categoryId, sourceId, content, sourcePrompt }) => {
      const item = { category: categoryId, block: sourceId };
      if (content !== sourcePrompt) item.content = content;
      return item;
    })
  };
  return JSON.stringify(recipe, null, 2);
}

export function parseRecipe(code, resolveBlock) {
  const data = JSON.parse(code.trim());
  if (data?.version !== 1 || !Array.isArray(data.blocks) || data.blocks.length > 50) {
    throw new Error("Invalid recipe");
  }
  const counts = new Map();
  return data.blocks.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid recipe block");
    const source = resolveBlock(item.category, item.block);
    if (!source || (item.content !== undefined && typeof item.content !== "string")) {
      throw new Error("Invalid recipe block");
    }
    const sourceKey = `${source.categoryId}:${source.id}`;
    const count = (counts.get(sourceKey) || 0) + 1;
    if (count > 2) throw new Error("Recipe block limit exceeded");
    counts.set(sourceKey, count);
    return {
      instanceId: crypto.randomUUID(),
      sourceId: source.id,
      name: source.name,
      type: source.type,
      categoryId: source.categoryId,
      categoryName: source.categoryName,
      color: source.color,
      sourcePrompt: source.prompt,
      content: (item.content ?? source.prompt).slice(0, 12000)
    };
  });
}
