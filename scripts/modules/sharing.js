const COMPRESSED_RECIPE_PREFIX = "PP2.";
const MAX_RECIPE_BYTES = 3_000_000;

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid compressed recipe");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function readStream(stream) {
  const chunks = [];
  const reader = stream.getReader();
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_RECIPE_BYTES) {
      await reader.cancel();
      throw new Error("Recipe is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function compressRecipe(value) {
  const stream = new Blob([value]).stream().pipeThrough(new CompressionStream("gzip"));
  return bytesToBase64Url(await readStream(stream));
}

async function decompressRecipe(value) {
  const bytes = base64UrlToBytes(value);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new TextDecoder().decode(await readStream(stream));
}

export async function serializeRecipe(blocks) {
  const recipe = {
    version: 2,
    blocks: blocks.map(({ categoryId, sourceId, content, sourcePrompt, emphasized }) => {
      const item = { category: categoryId, block: sourceId, emphasized: Boolean(emphasized) };
      if (content !== sourcePrompt) item.content = content;
      return item;
    })
  };
  return COMPRESSED_RECIPE_PREFIX + await compressRecipe(JSON.stringify(recipe));
}

export async function parseRecipe(code, resolveBlock) {
  const normalized = code.trim();
  if (!normalized || normalized.length > MAX_RECIPE_BYTES * 2) throw new Error("Invalid recipe");
  const payload = normalized.startsWith(COMPRESSED_RECIPE_PREFIX)
    ? await decompressRecipe(normalized.slice(COMPRESSED_RECIPE_PREFIX.length))
    : normalized;
  const data = JSON.parse(payload);
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
