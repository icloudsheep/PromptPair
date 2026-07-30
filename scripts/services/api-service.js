async function parseResponse(response) {
  let data;
  try { data = await response.json(); } catch { throw new Error(`HTTP ${response.status}`); }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
export async function getModelStatus() { return parseResponse(await fetch("/api/health")); }

export async function consumeNdjsonStream(stream, onEvent) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const consumeLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event;
    try { event = JSON.parse(trimmed); }
    catch { throw new Error("生成服务返回了无效的流数据"); }
    onEvent(event);
  };
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    lines.forEach(consumeLine);
    if (done) break;
  }
  consumeLine(buffer);
}

export async function generatePrompt(blocks, { onDelta } = {}) {
  const counts = new Map();
  blocks.forEach((block) => {
    const key = `${block.categoryId}:${block.sourceId}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const response = await fetch("/api/generate", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      blocks: blocks.map(({ name, type, content, categoryId, sourceId }) => ({
        title: name,
        type,
        content,
        source: `${categoryId}:${sourceId}`,
        emphasized: counts.get(`${categoryId}:${sourceId}`) === 2
      }))
    })
  });
  if (!response.ok) return parseResponse(response);
  if (!response.body) throw new Error("浏览器不支持流式响应");

  let content = "";
  await consumeNdjsonStream(response.body, (event) => {
    if (event.type === "delta" && typeof event.content === "string") {
      content += event.content;
      onDelta?.(event.content, content);
      return;
    }
    if (event.type === "error") throw new Error(event.message || "生成失败");
  });
  if (!content) throw new Error("模型返回了空内容");
  return { content };
}
