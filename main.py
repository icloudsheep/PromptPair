from __future__ import annotations

import argparse
import json
import mimetypes
import os
import re
import tempfile
import threading
import urllib.error
import urllib.request
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
APP_CONFIG = ROOT / "assets/config/app.json"
PROMPT_MANIFEST = ROOT / "assets/prompts/manifest.json"
MAX_BODY_SIZE = 512_000
MAX_BLOCKS = 50
MAX_CATEGORIES = 50
BLOCK_TYPES = {"role", "instruction", "context", "constraint", "quality"}
SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
SAFE_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
SETTINGS_WRITE_LOCK = threading.RLock()


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key:
            os.environ.setdefault(key, value)


def read_json(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{path.name} 必须是 JSON 对象")
    return data


def write_json_atomic(path: Path, data: dict[str, Any]) -> None:
    serialized = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(serialized)
    temporary.replace(path)


def api_protocol(base: str) -> str:
    path = urlparse(base).path.rstrip("/")
    return "anthropic" if path.endswith("/anthropic") or path.endswith("/v1/messages") else "openai"


def api_endpoint(base: str, protocol: Optional[str] = None) -> str:
    normalized = base.rstrip("/")
    protocol = protocol or api_protocol(normalized)
    if protocol == "anthropic":
        if normalized.endswith("/v1/messages"):
            return normalized
        return f"{normalized}/v1/messages"
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


def model_request(
    base: str, key: str, model: str, messages: list[dict[str, str]]
) -> tuple[str, dict[str, str], dict[str, Any], str]:
    protocol = api_protocol(base)
    temperature = float(os.getenv("LLM_TEMPERATURE", "0.3"))
    if protocol == "anthropic":
        system = "\n\n".join(message["content"] for message in messages if message["role"] == "system")
        conversation = [message for message in messages if message["role"] != "system"]
        headers = {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        body = {
            "model": model,
            "system": system,
            "messages": conversation,
            "max_tokens": int(os.getenv("LLM_MAX_TOKENS", "4096")),
            "temperature": temperature,
            "stream": True,
        }
        return api_endpoint(base, protocol), headers, body, protocol
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    body = {"model": model, "messages": messages, "temperature": temperature, "stream": True}
    return api_endpoint(base, protocol), headers, body, protocol


def model_content(response_data: dict[str, Any], protocol: str) -> str:
    try:
        if protocol == "anthropic":
            content = "".join(
                item.get("text", "")
                for item in response_data["content"]
                if isinstance(item, dict) and item.get("type") == "text"
            )
        else:
            content = response_data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError("模型响应格式不兼容") from error
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("模型返回了空内容")
    return content.strip()


def model_stream_delta(response_data: dict[str, Any], protocol: str) -> str:
    try:
        if protocol == "anthropic":
            delta = response_data.get("delta", {})
            content = delta.get("text", "") if response_data.get("type") == "content_block_delta" else ""
        else:
            choice = response_data.get("choices", [{}])[0]
            content = choice.get("delta", {}).get("content", "")
    except (IndexError, TypeError, AttributeError) as error:
        raise RuntimeError("模型流响应格式不兼容") from error
    if content is None:
        return ""
    if not isinstance(content, str):
        raise RuntimeError("模型流响应格式不兼容")
    return content


def prompt_files() -> dict[str, Path]:
    manifest = read_json(PROMPT_MANIFEST)
    result: dict[str, Path] = {}
    for entry in manifest.get("categories", []):
        category_id = str(entry.get("id", ""))
        file_path = str(entry.get("file", ""))
        if not SAFE_ID.fullmatch(category_id) or not file_path.startswith("/assets/prompts/"):
            raise ValueError("Prompt 清单包含无效路径")
        path = (ROOT / file_path.lstrip("/")).resolve()
        if path.parent != (ROOT / "assets/prompts").resolve() or path == PROMPT_MANIFEST:
            raise ValueError("Prompt 清单包含无效路径")
        result[category_id] = path
    return result


def load_settings() -> dict[str, Any]:
    app = read_json(APP_CONFIG)
    manifest = read_json(PROMPT_MANIFEST)
    files = prompt_files()
    categories = []
    for entry in manifest.get("categories", []):
        category = read_json(files[entry["id"]])
        categories.append({**category, "color": entry.get("color", "#738f77")})
    return {"app": app, "manifest": manifest, "categories": categories}


def clean_text(value: Any, field: str, maximum: int, required: bool = True) -> str:
    text = str(value if value is not None else "").strip()
    if required and not text:
        raise ValueError(f"{field} 不能为空")
    if len(text) > maximum:
        raise ValueError(f"{field} 不能超过 {maximum} 个字符")
    return text


def validate_category(payload: Any, expected_id: str) -> dict[str, Any]:
    if not isinstance(payload, dict) or payload.get("id") != expected_id:
        raise ValueError("分类 ID 不匹配")
    blocks = payload.get("blocks")
    if not isinstance(blocks, list) or len(blocks) > MAX_BLOCKS:
        raise ValueError(f"每个分类需要 0 到 {MAX_BLOCKS} 个积木")
    seen: set[str] = set()
    normalized = []
    for block in blocks:
        if not isinstance(block, dict):
            raise ValueError("积木格式无效")
        block_id = clean_text(block.get("id"), "积木 ID", 64)
        block_type = clean_text(block.get("type"), "积木类型", 32)
        if not SAFE_ID.fullmatch(block_id) or block_id in seen:
            raise ValueError("积木 ID 无效或重复")
        if block_type not in BLOCK_TYPES:
            raise ValueError("积木类型无效")
        seen.add(block_id)
        normalized.append(
            {
                "type": block_type,
                "id": block_id,
                "name": clean_text(block.get("name"), "积木名称", 120),
                "summary": clean_text(block.get("summary"), "积木说明", 300),
                "icon": clean_text(block.get("icon"), "积木图标", 8),
                "prompt": clean_text(block.get("prompt"), "Prompt 内容", 12_000),
            }
        )
    return {
        "id": expected_id,
        "name": clean_text(payload.get("name"), "分类名称", 80),
        "description": clean_text(payload.get("description"), "分类说明", 240),
        "blocks": normalized,
    }


def validate_color(value: Any) -> str:
    color = clean_text(value, "分类颜色", 7)
    if not SAFE_COLOR.fullmatch(color):
        raise ValueError("分类颜色必须是 #RRGGBB 格式")
    return color.lower()


def create_prompt_category(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("请求格式无效")
    category_id = clean_text(payload.get("id"), "分类 ID", 64)
    if not SAFE_ID.fullmatch(category_id):
        raise ValueError("分类 ID 只能包含小写字母、数字和连字符")
    manifest = read_json(PROMPT_MANIFEST)
    entries = manifest.get("categories")
    if not isinstance(entries, list):
        raise ValueError("Prompt 清单格式无效")
    if len(entries) >= MAX_CATEGORIES:
        raise ValueError(f"分类不能超过 {MAX_CATEGORIES} 个")
    files = prompt_files()
    category_path = (PROMPT_MANIFEST.parent / f"{category_id}.json").resolve()
    if category_id in files or category_path.exists():
        raise ValueError("分类 ID 已存在")
    category = validate_category(payload, category_id)
    color = validate_color(payload.get("color"))
    entry = {
        "id": category_id,
        "file": f"/assets/prompts/{category_id}.json",
        "color": color,
    }
    write_json_atomic(category_path, category)
    try:
        manifest["categories"] = [*entries, entry]
        write_json_atomic(PROMPT_MANIFEST, manifest)
    except OSError:
        category_path.unlink(missing_ok=True)
        raise
    return {**category, "color": color}


def update_prompt_category(category_id: str, payload: Any) -> dict[str, Any]:
    category = validate_category(payload, category_id)
    color = validate_color(payload.get("color"))
    manifest = read_json(PROMPT_MANIFEST)
    entries = manifest.get("categories")
    if not isinstance(entries, list):
        raise ValueError("Prompt 清单格式无效")
    files = prompt_files()
    category_path = files.get(category_id)
    if category_path is None:
        raise FileNotFoundError("分类不存在")
    entry_index = next((index for index, entry in enumerate(entries) if entry.get("id") == category_id), None)
    if entry_index is None:
        raise FileNotFoundError("分类不存在")
    previous_category = read_json(category_path)
    updated_entries = [dict(entry) for entry in entries]
    updated_entries[entry_index]["color"] = color
    updated_manifest = {**manifest, "categories": updated_entries}
    write_json_atomic(category_path, category)
    try:
        write_json_atomic(PROMPT_MANIFEST, updated_manifest)
    except OSError:
        write_json_atomic(category_path, previous_category)
        raise
    return {**category, "color": color}


def delete_prompt_category(category_id: str) -> None:
    if not SAFE_ID.fullmatch(category_id):
        raise ValueError("分类 ID 无效")
    manifest = read_json(PROMPT_MANIFEST)
    entries = manifest.get("categories")
    if not isinstance(entries, list):
        raise ValueError("Prompt 清单格式无效")
    category_path = prompt_files().get(category_id)
    if category_path is None:
        raise FileNotFoundError("分类不存在")
    manifest["categories"] = [entry for entry in entries if entry.get("id") != category_id]
    write_json_atomic(PROMPT_MANIFEST, manifest)
    try:
        category_path.unlink()
    except OSError:
        manifest["categories"] = entries
        write_json_atomic(PROMPT_MANIFEST, manifest)
        raise


def build_compiler_request(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        raise ValueError("请求格式无效")
    blocks = payload.get("blocks")
    if not isinstance(blocks, list) or not blocks:
        raise ValueError("至少需要一个 Prompt 积木")
    if len(blocks) > MAX_BLOCKS:
        raise ValueError(f"Prompt 积木不能超过 {MAX_BLOCKS} 个")

    normalized_blocks = []
    source_counts: dict[str, int] = {}
    for index, block in enumerate(blocks, start=1):
        if not isinstance(block, dict):
            raise ValueError("Prompt 积木格式无效")
        title = str(block.get("title", "")).strip()[:120]
        content = str(block.get("content", "")).strip()[:12_000]
        block_type = str(block.get("type", "instruction")).strip()
        source = str(block.get("source", "")).strip()
        if block_type not in BLOCK_TYPES:
            raise ValueError(f"第 {index} 个积木类型无效")
        if not content:
            raise ValueError(f"第 {index} 个积木没有内容")
        if not source or len(source) > 129 or ":" not in source:
            raise ValueError(f"第 {index} 个积木来源无效")
        if source in source_counts:
            raise ValueError("同一个 Prompt 积木只能占用一个工作台位置")
        emphasized = block.get("emphasized", False)
        if not isinstance(emphasized, bool):
            raise ValueError(f"第 {index} 个积木的强调状态无效")
        source_counts[source] = 1
        normalized_blocks.append(
            {
                "order": index,
                "type": block_type,
                "title": title,
                "content": content,
                "source": source,
                "emphasized": emphasized,
            }
        )

    roles = []
    requirements = []
    for normalized in normalized_blocks:
        (roles if normalized["type"] == "role" else requirements).append(normalized)

    system_prompt = (
        "你是一名 Prompt 架构师。请将输入融合成一份可直接交给 AI 使用的最终 Prompt。"
        "roles 中的多个身份不是互相替换，而是合并为一个兼具这些视角的复合角色；"
        "requirements 是被这个复合角色执行的内部要求，并按 order 保留优先顺序。"
        "当积木的 emphasized 为 true，表示用户重复选择了该要求以进行着重强调，"
        "必须在最终 Prompt 中明确、优先、完整地落实该内容；"
        "保留所有不冲突的约束，消除重复，解决轻微矛盾，使用清晰的 Markdown 层级。"
        "不要解释融合过程，不要添加代码围栏，只输出最终 Prompt。"
    )
    user_prompt = json.dumps(
        {"task": "融合角色与其内部 Prompt 积木", "roles": roles, "requirements": requirements},
        ensure_ascii=False,
        indent=2,
    )
    return [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}]


class PromptPairHandler(SimpleHTTPRequestHandler):
    server_version = "PromptPair/2.0"
    protocol_version = "HTTP/1.1"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("X-Frame-Options", "DENY")
        super().end_headers()

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            model_settings = (
                os.getenv("LLM_API_KEY", "").strip(),
                os.getenv("LLM_API_BASE", "").strip(),
                os.getenv("LLM_MODEL", "").strip(),
            )
            self.send_json(
                HTTPStatus.OK,
                {"ok": True, "modelConfigured": all(model_settings), "model": model_settings[2]},
            )
            return
        if path == "/api/settings":
            try:
                self.send_json(HTTPStatus.OK, load_settings())
            except (OSError, ValueError, json.JSONDecodeError) as error:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": str(error)})
            return
        super().do_GET()

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
        try:
            payload = self.read_payload()
            if path == "/api/settings/app":
                app = read_json(APP_CONFIG)
                locale = clean_text(payload.get("locale"), "语言", 20)
                locales = app.get("locales", [])
                selected = next((item for item in locales if item.get("id") == locale), None)
                if not selected:
                    raise ValueError("不支持该语言")
                app["locale"] = locale
                app["localePath"] = selected["path"]
                write_json_atomic(APP_CONFIG, app)
                self.send_json(HTTPStatus.OK, {"app": app})
                return
            prefix = "/api/settings/prompts/"
            if path.startswith(prefix):
                category_id = path[len(prefix):]
                if not SAFE_ID.fullmatch(category_id):
                    raise ValueError("分类 ID 无效")
                try:
                    with SETTINGS_WRITE_LOCK:
                        category = update_prompt_category(category_id, payload)
                except FileNotFoundError:
                    self.send_json(HTTPStatus.NOT_FOUND, {"error": "分类不存在"})
                    return
                self.send_json(HTTPStatus.OK, {"category": category})
                return
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "接口不存在"})
        except (json.JSONDecodeError, ValueError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except OSError:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "配置写入失败"})

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/settings/prompts":
            try:
                payload = self.read_payload()
                with SETTINGS_WRITE_LOCK:
                    category = create_prompt_category(payload)
                self.send_json(HTTPStatus.CREATED, {"category": category})
            except (json.JSONDecodeError, ValueError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            except OSError:
                self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "配置写入失败"})
            return
        if path != "/api/generate":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "接口不存在"})
            return
        try:
            payload = self.read_payload()
            messages = build_compiler_request(payload)
            self.send_model_stream(messages)
        except (json.JSONDecodeError, ValueError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except RuntimeError as error:
            self.send_json(HTTPStatus.BAD_GATEWAY, {"error": str(error)})
        except Exception:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "生成服务发生未知错误"})

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        prefix = "/api/settings/prompts/"
        if not path.startswith(prefix):
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "接口不存在"})
            return
        try:
            with SETTINGS_WRITE_LOCK:
                delete_prompt_category(path[len(prefix):])
            self.send_json(HTTPStatus.OK, {"deleted": True})
        except FileNotFoundError as error:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": str(error)})
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
        except OSError:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "配置写入失败"})

    def read_payload(self) -> dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("请求长度无效") from error
        if length <= 0 or length > MAX_BODY_SIZE:
            raise ValueError("请求内容过大或为空")
        payload = json.loads(self.rfile.read(length))
        if not isinstance(payload, dict):
            raise ValueError("请求格式无效")
        return payload

    def send_model_stream(self, messages: list[dict[str, str]]) -> None:
        base = os.getenv("LLM_API_BASE", "").strip()
        key = os.getenv("LLM_API_KEY", "").strip()
        model = os.getenv("LLM_MODEL", "").strip()
        if not base or not key or not model:
            raise ValueError("模型尚未配置，请检查根目录 .env")
        endpoint, headers, payload, protocol = model_request(base, key, model, messages)
        request_body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            endpoint,
            data=request_body,
            headers=headers,
            method="POST",
        )
        self.send_response(HTTPStatus.OK.value)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        received_content = False
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                for raw_line in response:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line or line.startswith("event:") or line.startswith(":"):
                        continue
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    if line == "[DONE]":
                        break
                    try:
                        response_data = json.loads(line)
                    except json.JSONDecodeError as error:
                        raise RuntimeError("模型流响应格式不兼容") from error
                    if response_data.get("type") == "error" or "error" in response_data:
                        detail = response_data.get("error", {})
                        message = detail.get("message") if isinstance(detail, dict) else str(detail)
                        raise RuntimeError(message or "模型服务返回流错误")
                    content = model_stream_delta(response_data, protocol)
                    if content:
                        received_content = True
                        self.send_stream_event({"type": "delta", "content": content})
            if not received_content:
                raise RuntimeError("模型返回了空内容")
            self.send_stream_event({"type": "done"})
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:1000]
            self.send_stream_event({"type": "error", "message": f"模型服务返回 {error.code}: {detail}"})
        except (urllib.error.URLError, TimeoutError) as error:
            reason = getattr(error, "reason", str(error))
            self.send_stream_event({"type": "error", "message": f"无法连接模型服务: {reason}"})
        except RuntimeError as error:
            self.send_stream_event({"type": "error", "message": str(error)})

    def send_stream_event(self, payload: dict[str, Any]) -> None:
        line = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
        try:
            self.wfile.write(line)
            self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True

    def send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status.value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    parser = argparse.ArgumentParser(description="PromptPair local server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    load_env(ROOT / ".env")
    mimetypes.add_type("text/javascript", ".js")
    server = ThreadingHTTPServer((args.host, args.port), PromptPairHandler)
    print(f"PromptPair is running at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nPromptPair stopped")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
