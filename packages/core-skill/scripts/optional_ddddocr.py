"""
Optional OCR helper for agent-controlled workflows.

This module is intentionally opt-in. Do not use it to bypass logins,
captchas, or access controls on judicial or enforcement websites.
"""

from __future__ import annotations

from pathlib import Path
import sys


def recognize_image(image_path: str) -> str:
    try:
        import ddddocr  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "ddddocr is not installed. Install it only for compliant OCR use cases."
        ) from exc

    image = Path(image_path).read_bytes()
    ocr = ddddocr.DdddOcr(show_ad=False)
    return ocr.classification(image)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: optional_ddddocr.py <image_path>")
    print(recognize_image(sys.argv[1]))
