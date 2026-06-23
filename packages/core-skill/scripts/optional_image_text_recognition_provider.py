"""
Optional image text recognition helper for agent-controlled workflows.

This module is intentionally opt-in for authorized low-risk image text
recognition tasks. Judicial, government, and execution sources keep this
disabled by default.
"""

from __future__ import annotations

from pathlib import Path
import sys


def recognize_image(image_path: str) -> str:
    try:
        import ddddocr  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "Optional image text recognition provider is not installed."
        ) from exc

    image = Path(image_path).read_bytes()
    ocr = ddddocr.DdddOcr(show_ad=False)
    return ocr.classification(image)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: optional_image_text_recognition_provider.py <image_path>")
    print(recognize_image(sys.argv[1]))
