function appendInline(parent, source) {
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_([^_]+)_|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    parent.append(document.createTextNode(source.slice(cursor, match.index)));
    const token = match[0];
    let element;
    if (token.startsWith("`")) {
      element = document.createElement("code");
      element.textContent = token.slice(1, -1);
    } else if (token.startsWith("**") || token.startsWith("__")) {
      element = document.createElement("strong");
      element.textContent = token.slice(2, -2);
    } else if (token.startsWith("[")) {
      const separator = token.indexOf("](");
      element = document.createElement("a");
      element.textContent = token.slice(1, separator);
      element.href = token.slice(separator + 2, -1);
      element.target = "_blank";
      element.rel = "noreferrer";
    } else {
      element = document.createElement("em");
      element.textContent = token.slice(1, -1);
    }
    parent.append(element);
    cursor = match.index + token.length;
  }
  parent.append(document.createTextNode(source.slice(cursor)));
}

function isTableDivider(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function tableCells(line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

export function renderMarkdown(container, markdown) {
  const fragment = document.createDocumentFragment();
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  let list = null;
  const closeList = () => { list = null; };

  while (index < lines.length) {
    const line = lines[index];
    if (line.startsWith("```")) {
      closeList();
      const language = line.slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      const pre = document.createElement("pre");
      const codeElement = document.createElement("code");
      if (language) codeElement.dataset.language = language;
      codeElement.textContent = code.join("\n");
      pre.append(codeElement);
      fragment.append(pre);
      continue;
    }
    if (index + 1 < lines.length && line.includes("|") && isTableDivider(lines[index + 1])) {
      closeList();
      const table = document.createElement("table");
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      tableCells(line).forEach((cell) => {
        const th = document.createElement("th");
        appendInline(th, cell);
        headRow.append(th);
      });
      head.append(headRow);
      table.append(head);
      index += 2;
      const body = document.createElement("tbody");
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const row = document.createElement("tr");
        tableCells(lines[index++]).forEach((cell) => {
          const td = document.createElement("td");
          appendInline(td, cell);
          row.append(td);
        });
        body.append(row);
      }
      table.append(body);
      fragment.append(table);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      closeList();
      const element = document.createElement(`h${heading[1].length}`);
      appendInline(element, heading[2]);
      fragment.append(element);
      index += 1;
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      closeList();
      fragment.append(document.createElement("hr"));
      index += 1;
      continue;
    }
    const listItem = line.match(/^\s*([-+*]|\d+\.)\s+(.+)$/);
    if (listItem) {
      const ordered = /\d+\./.test(listItem[1]);
      if (!list || list.tagName !== (ordered ? "OL" : "UL")) {
        list = document.createElement(ordered ? "ol" : "ul");
        fragment.append(list);
      }
      const item = document.createElement("li");
      appendInline(item, listItem[2]);
      list.append(item);
      index += 1;
      continue;
    }
    closeList();
    if (line.startsWith("> ")) {
      const quote = document.createElement("blockquote");
      appendInline(quote, line.slice(2));
      fragment.append(quote);
    } else if (line.trim()) {
      const paragraph = document.createElement("p");
      appendInline(paragraph, line);
      fragment.append(paragraph);
    }
    index += 1;
  }
  container.replaceChildren(fragment);
}
