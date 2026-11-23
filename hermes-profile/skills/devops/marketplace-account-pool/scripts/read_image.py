"""Read an image with a vision model (OpenRouter).

Use it on marketplace material that arrives as a picture: a card screenshot,
an example review, a photo the client sent.

Local OCR is the wrong tool for marketplace screenshots — they are rendered
small with anti-aliased UI text, and OCR returns an empty string more often
than not. A vision model reads them, and it also answers the question that
matters first: **what IS this picture**. An attachment assumed to be a card
screenshot is often something else entirely, and a wrong assumption costs
more than the read.

Usage:
    python read_image.py <image> ["<question>"] [--model <id>]

The API key is read from the Hermes config (the openrouter block) or from
OPENROUTER_API_KEY. It is never printed.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://openrouter.ai/api/v1"

# Substrings of model ids known to accept image input. Ordered by how well
# they read dense UI text.
VISION_HINTS = (
    "gpt-4o",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "llama-3.2-11b",
    "qwen2.5-vl",
    "pixtral",
)

DEFAULT_QUESTION = (
    "Опиши, что на картинке. Если это скриншот карточки — выпиши название "
    "организации, город, адрес и рейтинг. Если это не скриншот карточки — "
    "так и скажи прямо."
)


def hermes_config() -> Path:
    home = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    return home / "hermes" / "config.yaml"


def api_key() -> str:
    env = os.environ.get("OPENROUTER_API_KEY")
    if env:
        return env
    cfg = hermes_config()
    if not cfg.exists():
        raise SystemExit(f"нет конфига {cfg} и нет OPENROUTER_API_KEY в окружении")
    text = cfg.read_text(encoding="utf-8", errors="replace")
    i = text.find("openrouter")
    region = text[i : i + 2000] if i >= 0 else text
    for candidate in (region, text):
        m = re.search(r"api_key:\s*['\"]?([A-Za-z0-9_\-.]{20,})", candidate)
        if m:
            return m.group(1)
    raise SystemExit("в config.yaml не найден api_key для openrouter")


def pick_model(key: str, override: str | None) -> str:
    if override:
        return override
    req = urllib.request.Request(f"{API}/models", headers={"Authorization": f"Bearer {key}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.load(r)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return "google/gemini-2.5-flash"
    ids = [m.get("id", "") for m in data.get("data", []) if m.get("id")]
    for hint in VISION_HINTS:
        for mid in ids:
            if hint in mid.lower():
                return mid
    return "google/gemini-2.5-flash"


def encode_image(path: Path) -> tuple[str, str]:
    """Return (mime, base64 payload), downscaling to 1568px if Pillow is there."""
    raw = path.read_bytes()
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    try:
        from PIL import Image  # type: ignore
        import io

        im = Image.open(io.BytesIO(raw)).convert("RGB")
        if max(im.size) > 1568:
            im.thumbnail((1568, 1568))
        buf = io.BytesIO()
        im.save(buf, format="JPEG", quality=90)
        raw = buf.getvalue()
        mime = "image/jpeg"
    except Exception:
        pass
    return mime, base64.b64encode(raw).decode("ascii")


def ask(key: str, model: str, mime: str, b64: str, question: str) -> str:
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": question},
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime};base64,{b64}"},
                    },
                ],
            }
        ],
    }
    req = urllib.request.Request(
        f"{API}/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.load(r)
    return (data["choices"][0]["message"]["content"] or "").strip()


def main() -> int:
    ap = argparse.ArgumentParser(description="Read an image with a vision model.")
    ap.add_argument("image")
    ap.add_argument("question", nargs="?", default=DEFAULT_QUESTION)
    ap.add_argument("--model", default=None)
    args = ap.parse_args()

    path = Path(args.image)
    if not path.exists():
        raise SystemExit(f"нет файла: {path}")
    key = api_key()
    model = pick_model(key, args.model)
    mime, b64 = encode_image(path)
    print(f"модель: {model}\n")
    try:
        print(ask(key, model, mime, b64, args.question))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:600]
        raise SystemExit(f"HTTP {e.code}: {body}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
