"""YiJie's bounded local document helper. Run with the bundled Python -I -B.

No package installation, network fetch, system interpreter/Office discovery, or
process killing. Input is data. This helper is not a tool/permission authority.
"""
import argparse
import csv
import fcntl
import hashlib
import html
import io
import json
import math
import os
import posixpath
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile
from contextlib import contextmanager

ROOT = Path(__file__).resolve().parents[1]
FORMATS = ("txt", "md", "html", "csv", "json", "docx", "pptx", "xlsx", "pdf")
MIB = 1024 * 1024
FONT = "YiJie Document Sans"
csv.field_size_limit(MIB)
STOP = False
STARTED = time.monotonic()


class DocumentError(Exception):
    pass


def stop_requested(_signal, _frame):
    global STOP
    STOP = True


def checkpoint():
    if STOP or time.monotonic() - STARTED > 900:
        raise DocumentError("cancelled: current child finished; no further work started")


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def source(value):
    path = Path(value).resolve(strict=True)
    if not path.is_file() or not 0 < path.stat().st_size <= 10 * MIB:
        raise DocumentError("source must be a nonempty regular file of at most 10 MiB")
    fmt = path.suffix[1:].lower()
    if fmt not in FORMATS:
        raise DocumentError("unsupported format")
    if fmt in FORMATS[:5] and path.stat().st_size > MIB:
        raise DocumentError("text source exceeds 1 MiB")
    return path, fmt


def output(value):
    path = Path(value).absolute()
    parent = path.parent.resolve(strict=True)
    if not parent.is_relative_to(Path.cwd().resolve()) or path.exists() or path.is_symlink():
        raise DocumentError("output must be a new file in the current workspace")
    return parent / path.name


def write_json(path, value):
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def publish_new_file(source_path, target):
    """Atomic publication without replacing an existing user-selected path."""
    checkpoint()
    with source_path.open("rb") as stream:
        os.fsync(stream.fileno())
    os.link(source_path, target)
    source_path.unlink()


@contextmanager
def staged_output(target):
    # Both files are on the same filesystem. Only this owned temporary tree is
    # removed on a normal validation error/cancel; the requested name stays free.
    with tempfile.TemporaryDirectory(prefix=".yijie-document-", dir=target.parent) as directory:
        yield Path(directory) / target.name


def child_ownership(job, done):
    marker = job / "owner.json"
    value = json.loads(marker.read_text())
    value["child_done"] = done
    temporary = job / ".owner-next.json"
    with temporary.open("w", encoding="utf-8") as stream:
        json.dump(value, stream)
    temporary.replace(marker)


def prune_finished_jobs(state):
    # Called under the same office lock. Unknown/live owners are retained.
    for directory in state.glob("job-*"):
        marker = directory / "owner.json"
        if not directory.is_dir() or directory.is_symlink() or not marker.is_file() or marker.is_symlink() or marker.stat().st_size > 4096:
            continue
        try:
            value = json.loads(marker.read_text())
        except (ValueError, OSError):
            continue
        if value.get("schema_version") != 1 or value.get("kind") != "yijie-document-job" or value.get("child_done") is not True or value.get("expires_at", 2**63) > time.time():
            continue
        if any(p.is_symlink() for p in directory.rglob("*")):
            continue
        shutil.rmtree(directory)


def reserve_qa(target, state):
    index = state / "qa-index"
    index.mkdir(exist_ok=True)
    used = 0
    for entry in index.glob("*.json"):
        if entry.is_symlink() or entry.stat().st_size > 8192:
            raise DocumentError("QA cache index requires inspection")
        value = json.loads(entry.read_text())
        folder = Path(value["folder"])
        if value.get("schema_version") != 1 or not folder.is_absolute() or folder.is_symlink():
            raise DocumentError("QA cache owner unavailable")
        if not folder.exists():
            entry.unlink()
            continue
        if folder.resolve() != folder:
            raise DocumentError("QA cache location changed; files preserved")
        marker = folder / ".yijie-qa-owner.json"
        if not marker.is_file() or marker.is_symlink() or json.loads(marker.read_text()).get("id") != value["id"]:
            raise DocumentError("QA cache ownership changed; files preserved")
        files = list(folder.iterdir())
        allowed = all(p.is_file() and not p.is_symlink() and (p.name in {"layout.pdf", "receipt.json", ".yijie-qa-owner.json"} or re.fullmatch(r"page-\d{3}\.png", p.name)) for p in files)
        if not allowed:
            raise DocumentError("QA folder contains additional files; original data preserved")
        if value["expires_at"] <= time.time():
            shutil.rmtree(folder)
            entry.unlink()
        else:
            used += sum(p.stat().st_size for p in files)
    # Reserve the maximum job quota before rendering, shared by native preview
    # and model QA. Originals are not counted/deleted as derived page caches.
    if used > 384 * MIB:
        raise DocumentError("shared visual QA cache budget reached")
    target.mkdir()
    identity = str(uuid.uuid4())
    value = {"schema_version": 1, "id": identity, "folder": str(target), "expires_at": int(time.time()) + 86400}
    write_json(target / ".yijie-qa-owner.json", {"id": identity})
    write_json(index / (identity + ".json"), value)


def office_preflight(path, embedded=False, budget=None):
    from defusedxml import ElementTree as ET
    if budget is None:
        budget = [32 * MIB]
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        budget[0] -= sum(e.file_size for e in entries)
        if len(entries) > 512 or budget[0] < 0:
            raise DocumentError("Office package exceeds document budget")
        for entry in entries:
            if entry.file_size > 8 * MIB or entry.file_size > max(entry.compress_size, 1) * 100:
                raise DocumentError("Office part exceeds document budget")
            name = entry.filename.lower()
            if any(term in name for term in ("vbaproject", "/externallinks/", "activex", "xl/connections.xml", "/querytables/")):
                raise DocumentError("macro, embedded program or external workbook is unsupported")
            if name.endswith(".bin") and not (re.fullmatch(r"(?:word|ppt|xl)/printerSettings/printerSettings\d{1,8}\.bin", entry.filename) and entry.file_size <= 65536):
                raise DocumentError("unsupported binary Office part")
            if "/embeddings/" in name:
                # Editable PowerPoint charts contain a normal XLSX data package.
                # Admit that bounded data only, never OLE programs or recursion.
                if embedded or not name.startswith("ppt/embeddings/") or not name.endswith(".xlsx"):
                    raise DocumentError("embedded program or unsupported package")
                office_preflight(io.BytesIO(archive.read(entry)), embedded=True, budget=budget)
            if name.endswith(".rels"):
                for relationship in ET.fromstring(archive.read(entry)):
                    if relationship.get("TargetMode") == "External" and not relationship.get("Type", "").endswith("/hyperlink"):
                        raise DocumentError("external document resources are unsupported")
            if name.startswith("word/") and name.endswith(".xml"):
                for element in ET.fromstring(archive.read(entry)).iter():
                    tag = element.tag.rsplit("}", 1)[-1]
                    instruction = (element.text or "") if tag == "instrText" else " ".join(element.attrib.values()) if tag == "fldSimple" else ""
                    if re.search(r"\b(?:DDEAUTO|DDE|INCLUDETEXT|INCLUDEPICTURE)\b", instruction, re.I):
                        raise DocumentError("external document fields are outside the baseline")
            if name.startswith("xl/") and name.endswith(".xml"):
                for element in ET.fromstring(archive.read(entry)).iter():
                    tag = element.tag.rsplit("}", 1)[-1]
                    if tag in ("f", "definedName") and element.text:
                        validate_formula("=" + element.text.lstrip("="))
                    if tag == "calcPr" and element.get("iterate") in ("1", "true"):
                        raise DocumentError("iterative formulas are outside the baseline")


def validate_formula(value):
    from openpyxl.formula.tokenizer import Tokenizer
    for token in Tokenizer(value).items:
        if token.type == "FUNC" and token.subtype == "OPEN" and token.value[:-1].upper() not in {"SUM", "AVERAGE", "MIN", "MAX", "COUNT", "IF"}:
            raise DocumentError("formula function outside supported recalculation baseline")
        if token.type == "OPERAND" and token.subtype == "RANGE" and any(c in token.value for c in ("[", "]", "|")):
            raise DocumentError("external or structured formula references are outside the baseline")


def workbook_bounds(book):
    if len(book.worksheets) > 10:
        raise DocumentError("workbook exceeds 10 sheets")
    cells, tiles = 0, 0
    for sheet in book.worksheets:
        cells += sheet.max_row * sheet.max_column
        tiles += math.ceil(sheet.max_row / 50) * math.ceil(sheet.max_column / 12)
    if cells > 12000 or tiles > 32:
        raise DocumentError("workbook exceeds 12000 rectangular cells or 32 visual tiles")
    return cells, tiles


def visual_extent(sheet):
    from openpyxl.utils.cell import coordinate_to_tuple
    row, col = sheet.max_row, sheet.max_column
    for shape in list(sheet._charts) + list(sheet._images):
        anchor = shape.anchor
        if isinstance(anchor, str):
            top, left = coordinate_to_tuple(anchor)
        elif hasattr(anchor, "_from"):
            top, left = anchor._from.row + 1, anchor._from.col + 1
            if hasattr(anchor, "to"):
                row, col = max(row, anchor.to.row + 2), max(col, anchor.to.col + 2)
                continue
        else:
            raise DocumentError("unrecognized drawing placement")
        # Width/height of charts are centimetres; images are pixels. Add a
        # margin to avoid cutting edge labels. This changes only the QA copy.
        is_chart = shape in sheet._charts
        width = shape.width * (96 / 2.54 if is_chart else 1)
        height = shape.height * (96 / 2.54 if is_chart else 1)
        row, col = max(row, top + math.ceil(height / 20) + 2), max(col, left + math.ceil(width / 64) + 2)
    return row, col


def inspect_file(path, fmt, offset=0, limit=12000):
    if fmt in ("docx", "pptx", "xlsx"):
        office_preflight(path)
    detail = {}
    if fmt in ("txt", "md", "html", "csv", "json"):
        text = path.read_text(encoding="utf-8-sig")
        if fmt == "json":
            # Python integers preserve arbitrary precision. Reject non-JSON NaN.
            json.loads(text, parse_constant=lambda _: (_ for _ in ()).throw(DocumentError("invalid JSON number")))
        if fmt == "csv":
            rows = list(csv.reader(io.StringIO(text)))
            detail.update(rows=len(rows), columns=max(map(len, rows), default=0))
    elif fmt == "docx":
        from docx import Document
        doc = Document(path)
        text = "\n".join(p.text for p in doc.paragraphs)
        for table in doc.tables:
            text += "\n" + "\n".join("\t".join(c.text for c in r.cells) for r in table.rows)
        for section in doc.sections:
            text += "\n" + "\n".join(p.text for p in section.header.paragraphs + section.footer.paragraphs)
        detail.update(paragraphs=len(doc.paragraphs), tables=len(doc.tables), images=len(doc.inline_shapes))
    elif fmt == "pptx":
        from pptx import Presentation
        deck = Presentation(path)
        if len(deck.slides) > 50:
            raise DocumentError("presentation exceeds 50 slides")
        chunks = []
        for i, slide in enumerate(deck.slides):
            chunks.append(f"Slide {i + 1}")
            for shape in slide.shapes:
                if shape.has_text_frame:
                    chunks.append(shape.text)
                elif shape.has_table:
                    chunks.extend("\t".join(c.text for c in row.cells) for row in shape.table.rows)
        text = "\n".join(chunks)
        detail["slides"] = len(deck.slides)
    elif fmt == "xlsx":
        from openpyxl import load_workbook
        book = load_workbook(path, data_only=False, keep_links=False)
        cells, tiles = workbook_bounds(book)
        text = "\n".join("[" + s.title + "]\n" + "\n".join("\t".join("" if c.value is None else str(c.value) for c in r) for r in s) for s in book)
        detail.update(sheets=len(book.worksheets), cells=cells, visual_tiles=tiles)
    else:
        from pypdf import PdfReader
        reader = PdfReader(path, strict=True)
        if reader.is_encrypted or len(reader.pages) > 50:
            raise DocumentError("encrypted PDF or PDF over 50 pages is unsupported")
        text = "\n".join(p.extract_text() or "" for p in reader.pages)
        detail.update(pages=len(reader.pages), text_available=bool(text.strip()), ocr=False)
    end = min(len(text), offset + limit)
    return {"format": fmt, "sha256": sha(path), "size_bytes": path.stat().st_size,
            **detail, "text": text[offset:end], "offset": offset, "next_offset": end if end < len(text) else None,
            "text_is_untrusted_data": True}


def child(args, cwd, state, log):
    checkpoint()
    env = {"PATH": "/usr/bin:/bin", "HOME": str(state), "TMPDIR": str(state), "LANG": "en_US.UTF-8",
           "PYTHONDONTWRITEBYTECODE": "1", "SAL_DISABLE_OPENCL": "1", "SAL_USE_VCLPLUGIN": "svp"}
    started = time.monotonic()
    pending = False
    with log.open("ab") as stream:
        # The current conversion owns its separate session. SIGINT requests the
        # parent to stop at the next boundary; it never kills a converter.
        child_ownership(state, False)
        try:
            process = subprocess.Popen(args, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=stream,
                                       stderr=stream, start_new_session=True)
        except OSError:
            # Popen did not return a child; retain diagnostics without inventing
            # an orphan owner that would block all future normal conversions.
            child_ownership(state, True)
            raise
        while process.poll() is None:
            if not pending and (STOP or time.monotonic() - started > 180):
                print(json.dumps({"status": "STOP_PENDING", "message": "waiting for normal converter exit"}), file=sys.stderr, flush=True)
                pending = True
            time.sleep(0.1)
        code = process.wait()
        child_ownership(state, True)
    if code:
        raise DocumentError(f"document child exited with status {code}; original preserved; see local job log; use native approval for platform access if required, never disable the sandbox automatically")
    checkpoint()
    if time.monotonic() - started > 180:
        raise DocumentError("soft conversion deadline exceeded; child exited normally")


@contextmanager
def heavy_job():
    value = os.environ.get("YIJIE_DOCUMENT_STATE_ROOT")
    if not value:
        raise DocumentError("application document state is not configured")
    state = Path(value)
    if not state.is_absolute() or state.resolve() != state or not state.is_dir() or state.is_symlink():
        raise DocumentError("application document state unavailable")
    metadata=state.stat()
    if metadata.st_uid!=os.geteuid() or stat.S_IMODE(metadata.st_mode)!=0o700:
        raise DocumentError("application document state must remain owner-only")
    # Advisory process-wide concurrency: app preview and native exec share it.
    queue = state / "queue"
    queue.mkdir(exist_ok=True)
    token = queue / str(uuid.uuid4())
    with (state / "queue.lock").open("a+b") as admission:
        fcntl.flock(admission, fcntl.LOCK_EX)
        if len(list(queue.iterdir())) >= 8:
            raise DocumentError("document queue is full")
        token.write_text(str(os.getpid()))
    try:
        with (state / "office.lock").open("a+b") as lock:
            waiting = time.monotonic()
            while True:
                checkpoint()
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() - waiting > 180:
                        raise DocumentError("document queue wait exceeded soft deadline")
                    time.sleep(0.1)
            # Acquiring the lock does not prove that a prior converter exited:
            # a helper can disappear while its separately owned child remains.
            # Never launch a conflicting converter against an uncertain owner.
            for directory in state.glob("job-*"):
                marker = directory / "owner.json"
                if not directory.is_dir() or directory.is_symlink() or not marker.is_file() or marker.is_symlink() or marker.stat().st_size > 4096:
                    raise DocumentError("STOP_PENDING: document job ownership requires inspection")
                owner = json.loads(marker.read_text())
                if owner.get("schema_version") != 1 or owner.get("kind") != "yijie-document-job" or owner.get("child_done") is not True:
                    raise DocumentError("STOP_PENDING: prior converter exit is unconfirmed")
            prune_finished_jobs(state)
            total = sum(p.stat().st_size for p in state.rglob("*") if p.is_file() and not p.is_symlink())
            if total > 1536 * MIB:
                raise DocumentError("document state budget reached; no new converter started")
            temporary = Path(tempfile.mkdtemp(prefix="job-", dir=state))
            write_json(temporary / "owner.json", {"schema_version": 1, "kind": "yijie-document-job", "expires_at": int(time.time()) + 86400, "child_done": True})
            try:
                yield temporary
            except BaseException:
                # Preserve ordinary failure diagnostics, never user originals.
                print(json.dumps({"retained_job": str(temporary)}), file=sys.stderr)
                raise
            else:
                shutil.rmtree(temporary)
    finally:
        token.unlink(missing_ok=True)


def office_convert(path, extension, job):
    profile = job / ("profile-" + str(uuid.uuid4()))
    user = profile / "user"
    user.mkdir(parents=True)
    # Do not execute macros or update external links. No default user profile.
    (user / "registrymodifications.xcu").write_text('''<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>1</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item></oor:items>''')
    dest = job / ("output-" + str(uuid.uuid4()))
    dest.mkdir()
    soffice = ROOT / "office/LibreOffice.app/Contents/MacOS/soffice"
    child([str(soffice), "-env:UserInstallation=" + profile.as_uri(), "--headless", "--nologo", "--nodefault", "--nofirststartwizard", "--norestore", "--convert-to", extension, "--outdir", str(dest), str(path)], job, job, job / "conversion.log")
    result = dest / (path.stem + "." + extension.split(":")[0])
    if not result.is_file() or not 0 < result.stat().st_size <= 10 * MIB:
        raise DocumentError("converter produced no supported output")
    if sum(p.stat().st_size for p in job.rglob("*") if p.is_file()) > 512 * MIB:
        raise DocumentError("document temporary budget exceeded")
    return result


def recalculate(path, target, job):
    from openpyxl import load_workbook
    book = load_workbook(path, data_only=False, keep_links=False)
    workbook_bounds(book)
    formulas = {}
    for sheet in book:
        for row in sheet:
            for cell in row:
                if cell.data_type == "f":
                    validate_formula(cell.value)
                    formulas[(sheet.title, cell.coordinate)] = cell.value
    candidate = office_convert(path, "xlsx:Calc MS Excel 2007 XML", job)
    values = load_workbook(candidate, data_only=True, keep_links=False)
    checked = load_workbook(candidate, data_only=False, keep_links=False)
    if checked.sheetnames != book.sheetnames:
        raise DocumentError("recalculation changed sheet identity")
    for original in book:
        final = checked[original.title]
        if set(map(str, original.merged_cells.ranges)) != set(map(str, final.merged_cells.ranges)) or len(original._charts) != len(final._charts) or len(original._images) != len(final._images):
            raise DocumentError("recalculation changed merged ranges or document objects")
        for row in original:
            for cell in row:
                if cell.data_type != "f" and (final[cell.coordinate].value != cell.value or (cell.value is not None and final[cell.coordinate].data_type != cell.data_type)):
                    raise DocumentError("recalculation changed an input value or type")
    empty_results = empty_string_formula_results(candidate)
    for (sheet, address), formula in formulas.items():
        actual = checked[sheet][address].value
        value = values[sheet][address]
        if not isinstance(actual, str) or formula_key(actual) != formula_key(formula) or value.data_type == "e" or (value.value is None and (sheet, address) not in empty_results):
            raise DocumentError("formula or recalculated value failed validation")
    # Recheck the actual exported package, including the ordinary input limits.
    source(candidate)
    inspect_file(candidate, "xlsx", limit=0)
    with staged_output(target) as staged:
        with staged.open("xb") as dest, candidate.open("rb") as src:
            shutil.copyfileobj(src, dest)
        publish_new_file(staged, target)
    return {"formulas_checked": len(formulas), "sha256": sha(target)}


def formula_key(formula):
    """Compare tokens, allowing Calc's equivalent sheet-name quoting only.

    Do not remove whitespace from the formula string: intersections and quoted
    text are significant. In particular, IF string literals remain unchanged.
    """
    from openpyxl.formula.tokenizer import Tokenizer
    result = []
    for token in Tokenizer(formula).items:
        value = token.value
        if token.type == "OPERAND" and token.subtype == "RANGE":
            value = re.sub(r"'((?:[^']|'')+)'!", lambda m: m[1].replace("''", "'") + "!", value).upper()
        elif token.type == "FUNC":
            value = value.upper()
        result.append((token.type, token.subtype, value))
    return result


def empty_string_formula_results(path):
    # openpyxl returns None both for an absent cache and for Calc's explicit
    # empty string <c t="str"><f>...</f><v/></c>. Only the latter is calculated.
    from defusedxml import ElementTree as ET
    main = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    rel = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    result = set()
    with zipfile.ZipFile(path) as archive:
        relationships = {r.get("Id"): r.get("Target") for r in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        for sheet in ET.fromstring(archive.read("xl/workbook.xml")).find(main + "sheets"):
            target = relationships[sheet.get(rel)]
            part = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
            for cell in ET.fromstring(archive.read(part)).iter(main + "c"):
                value = cell.find(main + "v")
                if cell.get("t") == "str" and cell.find(main + "f") is not None and value is not None and not value.text:
                    result.add((sheet.get("name"), cell.get("r")))
    return result


def render(path, fmt, target, job, pdf_only=False):
    reserve_qa(target, job.parent)
    conversion = "pdf"
    if fmt == "xlsx":
        from openpyxl import load_workbook
        from openpyxl.worksheet.pagebreak import Break
        book = load_workbook(path, data_only=False, keep_links=False)
        workbook_bounds(book)
        extents = [visual_extent(s) for s in book]
        if sum(math.ceil(r / 50) * math.ceil(c / 12) for r, c in extents) > 32:
            raise DocumentError("drawings expand the workbook beyond 32 visual tiles")
        if all(r <= 50 and c <= 12 for r, c in extents):
            conversion = 'pdf:calc_pdf_Export:{"SinglePageSheets":{"type":"boolean","value":"true"}}'
        from openpyxl.utils.cell import get_column_letter
        for sheet, (last_row, last_col) in zip(book, extents):
            sheet.print_area = f"A1:{get_column_letter(last_col)}{last_row}"
            sheet.page_setup.orientation = "landscape"
            sheet.page_setup.paperSize = sheet.PAPERSIZE_A3
            sheet.sheet_properties.pageSetUpPr.fitToPage = False
            sheet.page_setup.scale = 100
            for row in range(50, last_row, 50):
                sheet.row_breaks.append(Break(id=row))
            for col in range(12, last_col, 12):
                sheet.col_breaks.append(Break(id=col))
        copy = job / "layout.xlsx"
        book.save(copy)
        path_for_conversion = copy
    else:
        path_for_conversion = path
    pdf = path if fmt == "pdf" else office_convert(path_for_conversion, conversion, job)
    projected = target / "layout.pdf"
    with projected.open("xb") as dest, pdf.open("rb") as src:
        shutil.copyfileobj(src, dest)
    from pypdf import PdfReader
    count = len(PdfReader(projected, strict=True).pages)
    if not 1 <= count <= (32 if fmt == "xlsx" else 50):
        raise DocumentError("layout exceeds the full-review page budget")
    images = []
    if not pdf_only:
        for number in range(1, count + 1):
            checkpoint()
            image = target / f"page-{number:03}.png"
            child([str(ROOT / "bin/yijie-document-render"), "page", str(projected), str(number), str(image)], Path.cwd(), job, job / "raster.log")
            images.append({"page": number, "path": str(image), "sha256": sha(image)})
            if sum(p.stat().st_size for p in target.iterdir() if p.is_file()) > 128 * MIB:
                raise DocumentError("visual QA cache exceeds 128 MiB")
    receipt = {"schema_version": 1, "source_sha256": sha(path), "format": fmt, "pages": count,
               "pdf": str(projected), "pdf_sha256": sha(projected), "images": images,
               "visual_review": "pending_native_view_image", "content_fact_check": "not_performed"}
    write_json(target / "receipt.json", receipt)
    return receipt


def create(spec, fmt, target):
    if not isinstance(spec, dict):
        raise DocumentError("document spec must be a JSON object")
    title = str(spec.get("title", "Document"))
    if not isinstance(spec.get("paragraphs", []), list):
        raise DocumentError("paragraphs must be an array")
    paragraphs = [str(p) for p in spec.get("paragraphs", [])]
    rows = spec.get("rows", [])
    if not isinstance(rows, list) or any(not isinstance(row, list) for row in rows):
        raise DocumentError("rows must be an array of arrays")
    if fmt in ("txt", "md", "html", "csv", "json"):
        if fmt == "json":
            text = json.dumps(spec.get("data", spec), ensure_ascii=False, indent=2, allow_nan=False) + "\n"
        elif fmt == "csv":
            stream = io.StringIO(newline="")
            csv.writer(stream).writerows(rows)
            text = stream.getvalue()
        elif fmt == "html":
            table = '<table>' + ''.join('<tr>' + ''.join('<td>' + html.escape(str(c)) + '</td>' for c in row) + '</tr>' for row in rows) + '</table>' if rows else ''
            text = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>' + html.escape(title) + '</title><body><h1>' + html.escape(title) + '</h1>' + ''.join('<p>' + html.escape(p) + '</p>' for p in paragraphs) + table + '</body></html>'
        else:
            text = ("# " if fmt == "md" else "") + title + "\n\n" + "\n\n".join(paragraphs) + "\n"
            if rows:
                if fmt == "md":
                    width = max(map(len, rows))
                    def line(row):
                        cells = [str(c).replace("\\", "\\\\").replace("|", "\\|").replace("\r\n", "\n").replace("\r", "\n").replace("\n", "<br>") for c in row]
                        return "| " + " | ".join(cells + [""] * (width - len(cells))) + " |\n"
                    text += "\n" + line(rows[0]) + line(["---"] * width) + "".join(line(row) for row in rows[1:])
                else:
                    stream = io.StringIO(newline="")
                    csv.writer(stream, delimiter="\t").writerows(rows)
                    text += "\n" + stream.getvalue()
        if len(text.encode()) > MIB:
            raise DocumentError("text generation exceeds 1 MiB")
        with target.open("x", encoding="utf-8", newline="") as stream:
            stream.write(text)
    elif fmt == "docx":
        from docx import Document
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
        from docx.shared import Pt
        doc = Document()
        for style in doc.styles:
            if hasattr(style, "font"):
                style.font.name = FONT
                style.font.size = Pt(11 if style.name == "Normal" else 14)
                rpr = style.element.get_or_add_rPr()
                fonts = rpr.find(qn("w:rFonts"))
                if fonts is None:
                    fonts = OxmlElement("w:rFonts")
                    rpr.append(fonts)
                fonts.set(qn("w:eastAsia"), FONT)
        doc.add_heading(title, 0)
        for paragraph in paragraphs:
            doc.add_paragraph(paragraph)
        if rows:
            table = doc.add_table(rows=0, cols=max(map(len, rows)))
            table.style = "Table Grid"
            for row in rows:
                for cell, value in zip(table.add_row().cells, row):
                    cell.text = str(value)
        doc.sections[0].footer.paragraphs[0].text = title
        with target.open("xb") as stream:
            doc.save(stream)
    elif fmt == "pptx":
        from pptx import Presentation
        from pptx.util import Inches, Pt
        deck = Presentation()
        slides = spec.get("slides", [{"title": title, "body": "\n".join(paragraphs)}])
        if not 1 <= len(slides) <= 50:
            raise DocumentError("slide count outside baseline")
        for data in slides:
            slide = deck.slides.add_slide(deck.slide_layouts[1])
            slide.shapes.title.text = str(data.get("title", title))
            slide.placeholders[1].text = str(data.get("body", ""))
            for shape in slide.shapes:
                if shape.has_text_frame:
                    for paragraph in shape.text_frame.paragraphs:
                        for run in paragraph.runs:
                            run.font.name = FONT
                            run.font.size = Pt(28 if shape == slide.shapes.title else 20)
        with target.open("xb") as stream:
            deck.save(stream)
    elif fmt == "xlsx":
        from openpyxl import Workbook
        from openpyxl.styles import Font
        from openpyxl.utils import get_column_letter
        book = Workbook()
        book.remove(book.active)
        for data in spec.get("sheets", [{"name": "Sheet1", "rows": rows}]):
            sheet = book.create_sheet(data["name"])
            for row in data.get("rows", []):
                sheet.append(row)
            for row in sheet:
                for cell in row:
                    cell.font = Font(name=FONT, size=11, bold=cell.row == 1)
            for column in range(1, sheet.max_column + 1):
                sheet.column_dimensions[get_column_letter(column)].width = 16
        workbook_bounds(book)
        with target.open("xb") as stream:
            book.save(stream)
    else:
        from reportlab import rl_config
        rl_config.useA85 = False
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
        pdfmetrics.registerFont(TTFont("YiJie", str(ROOT / "fonts/YiJieDocumentSans-Regular.ttf")))
        pdfmetrics.registerFont(TTFont("YiJieBold", str(ROOT / "fonts/YiJieDocumentSans-Bold.ttf")))
        normal = ParagraphStyle("body", fontName="YiJie", fontSize=11, leading=18, wordWrap="CJK")
        heading = ParagraphStyle("heading", parent=normal, fontName="YiJieBold", fontSize=22, leading=28, spaceAfter=18)
        flow = [Paragraph(html.escape(title), heading)]
        for paragraph in paragraphs:
            flow += [Paragraph(html.escape(paragraph), normal), Spacer(1, 8)]
        if rows:
            table = Table([[Paragraph(html.escape(str(c)), normal) for c in row] for row in rows])
            table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, "grey")]))
            flow.append(table)
        with target.open("xb") as stream:
            SimpleDocTemplate(stream, pageCompression=0, title=title).build(flow)


def main():
    if Path(sys.executable).resolve() != (ROOT / "python/bin/python3.12").resolve() or not sys.flags.isolated:
        raise DocumentError("use the application Python with -I -B")
    signal.signal(signal.SIGINT, stop_requested)
    signal.signal(signal.SIGTERM, stop_requested)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("inspect", "check", "render", "recalculate"):
        p = sub.add_parser(action)
        p.add_argument("input")
        if action == "inspect":
            p.add_argument("--offset", type=int, default=0)
            p.add_argument("--limit", type=int, default=12000)
        if action in ("render", "recalculate"):
            p.add_argument("--output", required=True)
        if action == "render":
            p.add_argument("--pdf-only", action="store_true")
    p = sub.add_parser("create")
    p.add_argument("--format", choices=FORMATS, required=True)
    p.add_argument("--spec", required=True)
    p.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.action == "create":
        specpath, _ = source(args.spec)
        target = output(args.output)
        if target.suffix.lower() != "." + args.format:
            raise DocumentError("output extension must match format")
        with staged_output(target) as staged:
            create(json.loads(specpath.read_text(encoding="utf-8-sig")), args.format, staged)
            path, fmt = source(staged)
            result = inspect_file(path, fmt, limit=0)
            publish_new_file(staged, target)
        result.pop("text")
        result.update(status="generated", path=str(target), visual_review="pending")
    else:
        path, fmt = source(args.input)
        offset, limit = getattr(args, "offset", 0), getattr(args, "limit", 0)
        if offset < 0 or not 0 <= limit <= 12000:
            raise DocumentError("invalid reading window")
        result = inspect_file(path, fmt, offset, limit)
        if args.action != "inspect":
            result.pop("text")
        if args.action in ("render", "recalculate"):
            if fmt in ("docx", "pptx", "xlsx") and os.environ.get("CODEX_SANDBOX") == "seatbelt":
                # LibreOffice's platform IPC is outside the default native
                # workspace sandbox. Do not launch a doomed child or alter the
                # sandbox. The model must request the existing native approval.
                raise DocumentError("native_platform_approval_required: request native approval for this exact managed Office conversion; no converter was started")
            target = output(args.output)
            with heavy_job() as job:
                if args.action == "recalculate" and fmt == "xlsx":
                    result = recalculate(path, target, job)
                elif args.action == "render" and fmt in ("docx", "pptx", "xlsx", "pdf"):
                    result = render(path, fmt, target, job, args.pdf_only)
                else:
                    raise DocumentError("operation unsupported for this format")
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except (DocumentError, OSError, ValueError, csv.Error, zipfile.BadZipFile) as error:
        print(json.dumps({"status": "unavailable", "message": str(error)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
