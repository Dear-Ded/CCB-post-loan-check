import argparse
import json
import os
import zipfile
from datetime import datetime
from pathlib import Path

from PIL import Image
from lxml import etree


def safe_filename(value: str) -> str:
    bad = '<>:"/\\|?*\x00'
    for ch in bad:
        value = value.replace(ch, "_")
    return value.strip()[:120]


def text_from_codepoints(*codepoints: int) -> str:
    return "".join(chr(item) for item in codepoints)


def normalize_to_template_png(src: Path, size=(1268, 755)) -> bytes:
    img = Image.open(src).convert("RGB")
    if img.size != size:
        canvas = Image.new("RGB", size, "white")
        img.thumbnail(size, Image.Resampling.LANCZOS)
        x = (size[0] - img.width) // 2
        y = (size[1] - img.height) // 2
        canvas.paste(img, (x, y))
        img = canvas
    from io import BytesIO
    out = BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def screenshot_sequence(manifest: dict):
    if manifest.get("screenshots"):
        return [
            Path(item["screenshot"])
            for item in manifest.get("screenshots", [])
            if item.get("screenshot") and Path(item["screenshot"]).exists()
        ]
    paths = []
    for target in manifest.get("targets", []):
        screenshot = target.get("screenshot")
        if screenshot and Path(screenshot).exists():
            paths.append(Path(screenshot))
    return paths


def build_by_replacing_template_media(template_path: Path, manifest: dict, output_path: Path):
    screenshots = screenshot_sequence(manifest)
    if not screenshots:
        raise SystemExit("No screenshots found in manifest")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(template_path, "r") as zin:
        all_files = {item.filename: zin.read(item.filename) for item in zin.infolist()}
        infos = {item.filename: item for item in zin.infolist()}

    media_names = sorted(
        [name for name in all_files if name.startswith("word/media/image") and name.endswith(".png")],
        key=lambda n: int(Path(n).stem.replace("image", ""))
    )

    if len(screenshots) > len(media_names):
        extra_count = len(screenshots) - len(media_names)
        doc_xml = etree.fromstring(all_files["word/document.xml"])
        rels_xml = etree.fromstring(all_files["word/_rels/document.xml.rels"])
        ns = {
            "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
            "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
        }
        body = doc_xml.find("w:body", ns)
        sect_pr = body.find("w:sectPr", ns)
        drawing_paras = [p for p in body.findall("w:p", ns) if p.find(".//w:drawing", ns) is not None]
        if not drawing_paras:
            raise SystemExit("Template has no drawing paragraphs to clone")
        template_para = drawing_paras[-1]
        rel_ids = []
        for rel in rels_xml.findall("rel:Relationship", ns):
            rid = rel.get("Id", "")
            if rid.startswith("rId") and rid[3:].isdigit():
                rel_ids.append(int(rid[3:]))
        next_rid_num = max(rel_ids or [0]) + 1
        for i in range(extra_count):
            image_num = len(media_names) + i + 1
            rid = f"rId{next_rid_num + i}"
            image_name = f"word/media/image{image_num}.png"
            media_names.append(image_name)
            clone = etree.fromstring(etree.tostring(template_para))
            blip = clone.find(".//a:blip", ns)
            if blip is not None:
                blip.set(f"{{{ns['r']}}}embed", rid)
            doc_pr = clone.find(".//wp:docPr", {"wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"})
            if doc_pr is not None:
                doc_pr.set("id", str(image_num))
                doc_pr.set("name", f"Picture {image_num}")
            body.insert(list(body).index(sect_pr), clone)
            rel = etree.Element(f"{{{ns['rel']}}}Relationship")
            rel.set("Id", rid)
            rel.set("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image")
            rel.set("Target", f"media/image{image_num}.png")
            rels_xml.append(rel)
            all_files[image_name] = b""

        all_files["word/document.xml"] = etree.tostring(doc_xml, xml_declaration=True, encoding="UTF-8", standalone="yes")
        all_files["word/_rels/document.xml.rels"] = etree.tostring(rels_xml, xml_declaration=True, encoding="UTF-8", standalone="yes")

    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, data in all_files.items():
            item = infos.get(name, zipfile.ZipInfo(name))
            if name in media_names:
                idx = media_names.index(name)
                if idx < len(screenshots):
                    data = normalize_to_template_png(screenshots[idx])
            zout.writestr(item, data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--template")
    parser.add_argument("--out")
    parser.add_argument("--allow-unverified", action="store_true")
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    bad_targets = [
        t for t in manifest.get("targets", [])
        if (not t.get("ok")) or bool(t.get("suspicious"))
    ]
    bad_screenshots = [
        item for item in manifest.get("screenshots", [])
        if item.get("validation") and not item.get("validation", {}).get("ok")
    ]
    if bad_targets and not args.allow_unverified:
        names = ", ".join(t.get("targetName") or t.get("name") or t.get("id", "unknown") for t in bad_targets)
        raise SystemExit(f"Refusing to build final report because these pages are unresolved: {names}")
    if bad_screenshots and not args.allow_unverified:
        names = ", ".join(item.get("name", "unknown") for item in bad_screenshots)
        details = "; ".join(
            f"{item.get('name', 'unknown')}: {', '.join(item.get('validation', {}).get('problems', []))}"
            for item in bad_screenshots
        )
        raise SystemExit(f"Refusing to build final report because these screenshots failed validation: {names}. {details}")
    required_evidence = manifest.get("requiredEvidence") or {}
    if required_evidence and not required_evidence.get("ok", False) and not args.allow_unverified:
        missing = required_evidence.get("missingRequired") or []
        details = "; ".join(
            f"{item.get('id', 'unknown')}: {item.get('missingReason', '')}"
            for item in missing
        )
        raise SystemExit(f"Refusing to build final report because required evidence is incomplete: {details}")

    skill_root = Path(os.environ.get("POST_LOAN_SKILL_ROOT", Path(__file__).resolve().parents[1]))
    default_template_name = text_from_codepoints(36151, 21518, 26597, 35810, 27169, 26495) + ".docx"
    default_report_prefix = text_from_codepoints(36151, 21518, 26597, 35810)
    template_path = Path(args.template) if args.template else skill_root / "assets" / default_template_name
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")

    date_str = datetime.now().strftime("%Y%m%d")
    output_path = Path(args.out) if args.out else manifest_path.parent / f"{default_report_prefix}-{safe_filename(manifest['company'])}-{date_str}.docx"
    build_by_replacing_template_media(template_path, manifest, output_path)

    manifest["reportDocx"] = str(output_path)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(output_path).encode("utf-8", errors="replace").decode("utf-8", errors="replace"))


if __name__ == "__main__":
    main()
