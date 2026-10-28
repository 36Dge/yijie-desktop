#!/usr/bin/env python3
"""Build only ordinary synthetic FEAT-165 samples, outside product resources.

Uses the installed ffmpeg solely to produce a normal three-second test clip.
No network, model calls, archive attack cases or product/runtime modifications.
"""
import argparse
import binascii
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import zipfile
import zlib


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(args.output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    if any(root.iterdir()):
        raise SystemExit("Use a new empty fixture directory; existing files are not overwritten")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("Installed ffmpeg is required to build the normal sample")
    for name, content in {
        "sample.txt": "FEAT-165 normal synthetic text.\n",
        "sample.md": "# FEAT-165\n\nNormal synthetic Markdown.\n",
        "sample.csv": "name,value\nalpha,12\nbeta,34\n",
        "sample.html": '<!doctype html><html lang="zh"><meta charset="utf-8"><title>FEAT-165</title><h1>普通交互报告</h1><button onclick="this.textContent=\'已点击\'">点击验证</button></html>',
        "sample.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="teal"/><circle cx="120" cy="80" r="48" fill="white"/></svg>',
    }.items():
        (root / name).write_text(content)
    for ext, part, main_type, body in [
        ("docx", "word/document.xml", "wordprocessingml.document", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>FEAT-165 normal document</w:t></w:r></w:p></w:body></w:document>'),
        ("pptx", "ppt/presentation.xml", "presentationml.presentation", '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>'),
    ]:
        with zipfile.ZipFile(root / ("sample." + ext), "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("[Content_Types].xml", f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/{part}" ContentType="application/vnd.openxmlformats-officedocument.{main_type}.main+xml"/></Types>')
            archive.writestr("_rels/.rels", f'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="{part}"/></Relationships>')
            archive.writestr(part, body)
            if ext == "pptx":
                archive.writestr("ppt/slides/slide1.xml", '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><a:t xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">FEAT-165 normal slide</a:t></p:cSld></p:sld>')
    stream = b"BT /F1 18 Tf 50 150 Td (FEAT-165 normal PDF) Tj ET"
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>", b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>", b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 240] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream"]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf += f"{index} 0 obj\n".encode() + obj + b"\nendobj\n"
    xref = len(pdf)
    pdf += b"xref\n0 6\n0000000000 65535 f \n" + b"".join(f"{offset:010} 00000 n \n".encode() for offset in offsets[1:])
    pdf += f"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    (root / "sample.pdf").write_bytes(pdf)
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", binascii.crc32(kind + data))
    rows = b"".join(b"\0" + bytes([40, 150, 150]) * 240 for _ in range(160))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 240, 160, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
    (root / "sample.png").write_bytes(png)
    subprocess.run([ffmpeg, "-v", "error", "-i", str(root / "sample.png"), "-frames:v", "1", str(root / "sample.jpg")], check=True)
    shutil.copyfile(root / "sample.jpg", root / "sample.jpeg")
    subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc=size=240x160:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", str(root / "sample.mp4")], check=True)
    files = [{"name": file.name, "size": file.stat().st_size, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()} for file in sorted(root.iterdir())]
    assert len(files) == 12
    print(json.dumps({"directory": str(root), "files": files}, indent=2))


if __name__ == "__main__":
    main()
