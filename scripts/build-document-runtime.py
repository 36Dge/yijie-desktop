#!/usr/bin/env python3
"""Build FEAT-171's private, relocatable document dependencies from pinned sources.

Never reads Codex caches or installs into the system. Interrupted builds retain
their stage and logs. Only verified upstream archives enter the new build root.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "document-runtime/dependencies.lock.json"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def fetch(folder, url, sha, size=None):
    target = folder / url.rsplit("/", 1)[-1]
    if target.exists():
        if digest(target) != sha:
            raise ValueError("Cached source digest mismatch: " + target.name)
        return target
    part = target.with_suffix(target.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "Yijie-document-build/1"})
    with urllib.request.urlopen(request, timeout=60) as source, part.open("wb") as dest:
        shutil.copyfileobj(source, dest)
    if digest(part) != sha or size is not None and part.stat().st_size != size:
        raise ValueError("Downloaded source failed verification: " + target.name)
    part.rename(target)
    return target


def run(args, cwd, env, logfile):
    with logfile.open("ab") as log:
        result = subprocess.run(args, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log)
    if result.returncode:
        raise ValueError(f"Build exited {result.returncode}; see {logfile}")


def unpack_wheel(wheel, target):
    # Upstream wheel hashes are locked. Restrict extraction to package files.
    with zipfile.ZipFile(wheel) as archive:
        for item in archive.infolist():
            rel = Path(item.filename)
            if rel.is_absolute() or ".." in rel.parts or (item.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Unsupported wheel entry")
            if item.is_dir():
                continue
            if any(part.endswith(".data") for part in rel.parts):
                # Neither optional macro extraction nor build-tool man pages
                # are runtime capabilities. Keep their original sources in
                # downloads; do not publish these command entrypoints.
                if item.filename.endswith(".data/scripts/vba_extract.py") or ".data/data/share/man/" in item.filename:
                    continue
                raise ValueError("Wheel requires a reviewed .data install layout")
            path = target / rel
            if path.exists():
                if path.is_file() and not path.is_symlink() and path.read_bytes() == archive.read(item):
                    continue
                raise ValueError("Wheel file conflict: " + str(rel))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(archive.read(item))


def prepare_office_and_fonts(work, stage, lock, env):
    office = stage / "office/LibreOffice.app"
    marker = work / "office-built.json"
    if not marker.exists():
        mount = work / "office-mount"
        mount.mkdir(exist_ok=True)
        dmg = work / "downloads" / lock["libreoffice"]["upstream_artifact_url"].rsplit("/", 1)[-1]
        run(["/usr/bin/hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", str(mount), str(dmg)], work, env, work / "office-assembly.log")
        try:
            applications = list(mount.glob("*.app"))
            if len(applications) != 1 or office.exists():
                raise ValueError("Office stage needs inspection before continuing")
            office.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(applications[0], office, symlinks=True)
        finally:
            # Normal detach only. No forced eject or process termination.
            run(["/usr/bin/hdiutil", "detach", str(mount)], work, env, work / "office-assembly.log")
        marker.write_text(json.dumps({"version": lock["libreoffice"]["version"], "upstream_sha256": lock["libreoffice"]["upstream_sha256"]}) + "\n")
    font = lock["fonts"][0]
    source = work / "downloads/NotoSansCJKsc-VF.ttf"
    if not source.exists():
        url = "https://raw.githubusercontent.com/notofonts/noto-cjk/" + font["tag_object"]["sha"] + "/" + font["source_file"]
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read(font["source_size_bytes"] + 1)
        actual = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        if len(data) != font["source_size_bytes"] or actual != font["source_git_blob"]:
            raise ValueError("Font source does not match its pinned Git object")
        source.write_bytes(data)
    fonts = stage / "fonts"
    fonts.mkdir(exist_ok=True)
    if not (work / "fonts-built.json").exists():
        builder = work / "build-fonts.py"
        builder.write_text('''import sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
source, target = Path(sys.argv[2]), Path(sys.argv[3])
for weight, style in [(400, "Regular"), (700, "Bold")]:
    font = TTFont(source, recalcTimestamp=False)
    instantiateVariableFont(font, {"wght":weight}, inplace=True)
    for name in font["name"].names:
        values = {1:"YiJie Document Sans",2:style,3:"YiJieDocumentSans-"+style,4:"YiJie Document Sans "+style,6:"YiJieDocumentSans-"+style,16:"YiJie Document Sans",17:style}
        if name.nameID in values:
            name.string = values[name.nameID].encode(name.getEncoding())
    font.recalcTimestamp=False
    font.save(target/("YiJieDocumentSans-"+style+".ttf"))
''')
        run([str(stage / "python/bin/python3.12"), "-I", "-B", str(builder), str(work / "build-site"), str(source), str(fonts)], work, env, work / "fonts-build.log")
        (work / "fonts-built.json").write_text(json.dumps({p.name: digest(p) for p in fonts.glob("*.ttf")}, indent=2) + "\n")
    license_file = fonts / "OFL.txt"
    if not license_file.exists():
        with urllib.request.urlopen(font["license_url"], timeout=60) as response:
            license_file.write_bytes(response.read(64 * 1024))
    (fonts / "CHANGES.txt").write_text("Noto Sans CJK Sans2.004; static weight 400/700 instances built with fonttools4.60.1. Renamed to YiJie Document Sans. OFL-1.1 and original copyrights retained.\n")
    # Quartz's AquaSalGraphics registers only LibreOffice's private resource
    # font folders (vcl/quartz/salgdi.cxx AddLocalTempFontDirs). Add new resources
    # to this project-owned assembly, never edit the upstream executable bytes.
    # This resource assembly needs its own distribution signing; it is not the
    # unmodified upstream signed application. The original DMG is retained.
    office_fonts = office / "Contents/Resources/fonts/truetype"
    for font_path in fonts.glob("*.ttf"):
        dest = office_fonts / font_path.name
        if dest.exists() and digest(dest) != digest(font_path):
            raise ValueError("Private font output conflict")
        if not dest.exists():
            shutil.copy2(font_path, dest)
    notices = stage / "notices"
    notices.mkdir(exist_ok=True)
    shutil.copy2(work / ("Python-" + lock["cpython"]["version"]) / "LICENSE", notices / "CPython-LICENSE.txt")
    shutil.copy2(LOCK, notices / "dependencies.lock.json")
    print("Office and private static fonts prepared", flush=True)


def assemble(work, stage, lock):
    renderer_env = {k: v for k, v in os.environ.items() if not k.startswith(("YIJIE_", "TAURI_", "VITE_"))}
    renderer_env.update(CARGO_TARGET_DIR=str(ROOT / ".local/document-render-target"), CARGO_NET_OFFLINE="true", MACOSX_DEPLOYMENT_TARGET="14.0")
    run(["cargo", "build", "--offline", "--manifest-path", str(ROOT / "src-tauri/Cargo.toml"), "--bin", "yijie-document-render", "--release"], ROOT, renderer_env, work / "renderer-build.log")
    source_lock = ROOT / "document-runtime/sources.lock.json"
    shutil.copy2(source_lock, stage / "notices/sources.lock.json")
    (stage / "notices/ASSEMBLY.txt").write_text(
        "Local nonrelease application assembly. CPython built from the pinned official source; Python wheels and the independent LibreOffice 26.8.2 upstream release verified by their pinned hashes. No Codex cache or system document packages. LibreOffice executable bytes are unchanged; two newly derived OFL fonts were added under its private Resources/fonts/truetype directory. This resource assembly is not the unmodified upstream signed app, and requires its own distribution qualification. Corresponding official sources are archived by scripts/build-document-runtime.py sources; source and third-party license closure must be retained with any future distribution. All upstream licenses in the app and wheel dist-info directories are preserved.\n")
    probe = """import sys,json,sysconfig,importlib.metadata as m
from lxml import etree
from PIL import features
print(json.dumps({'python':sys.version,'prefix':sys.prefix,'packages':{name:m.version(name) for name in ['python-docx','python-pptx','openpyxl','reportlab','pypdf','lxml','Pillow','typing_extensions','XlsxWriter','et_xmlfile','charset-normalizer','defusedxml']},'libxml2':etree.LIBXML_VERSION,'libxslt':etree.LIBXSLT_VERSION,'pillow_native':{name:features.version(name) for name in features.get_supported()},'build':{name:sysconfig.get_config_var(name) for name in ['CONFIG_ARGS','CC','CFLAGS','MACOSX_DEPLOYMENT_TARGET']}}))
"""
    actual = subprocess.check_output([str(stage / "python/bin/python3.12"), "-I", "-B", "-c", probe], cwd=work, text=True)
    actual = actual.replace(str(work), "<build-root>")
    inventory = json.loads(actual)
    inventory.update(schema_version=1, release=False, build_recipe_sha256=digest(Path(__file__)), dependency_lock_sha256=digest(LOCK),
                     office_upstream_sha256=lock["libreoffice"]["upstream_sha256"], office_internal_components="Retained upstream components, not alternate authoring environments; see preserved upstream LICENSE and corresponding source lock.")
    (stage / "notices/runtime-inventory.json").write_text(json.dumps(inventory, indent=2) + "\n")
    for source, target in [(ROOT / "document-runtime/helper", stage / "helper"), (ROOT / "document-runtime/guides", stage / "guides")]:
        target.mkdir(exist_ok=True)
        for path in source.iterdir():
            if path.is_file():
                shutil.copy2(path, target / path.name)
    renderer = ROOT / ".local/document-render-target/release/yijie-document-render"
    if not renderer.is_file():
        raise ValueError("Build the canonical yijie-document-render target first")
    (stage / "bin").mkdir(exist_ok=True)
    shutil.copy2(renderer, stage / "bin/yijie-document-render")
    files = []
    for path in sorted(stage.rglob("*")):
        name = path.relative_to(stage).as_posix()
        if path.is_symlink():
            link = os.readlink(path)
            if Path(link).is_absolute() or not path.resolve().is_relative_to(stage):
                raise ValueError("Bundle link is not relocatable: " + name)
            raw = link.encode()
            files.append(dict(path=name, kind="symlink", sha256=hashlib.sha256(raw).hexdigest(), size_bytes=len(raw), link_target=link))
        elif path.is_file():
            files.append(dict(path=name, kind="file", sha256=digest(path), size_bytes=path.stat().st_size, link_target=""))
    total = sum(f["size_bytes"] for f in files)
    if total > 2 * 1024**3 or len(files) > 30000:
        raise ValueError("Expanded document bundle exceeds budget")
    bundle_id = hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    manifest = dict(schema_version=1, bundle_id=bundle_id, platform="macos-arm64", minimum_macos="14.0",
        python_version=lock["cpython"]["version"], libreoffice_version=lock["libreoffice"]["version"],
        python="python/bin/python3.12", helper="helper/document_cli.py", renderer="bin/yijie-document-render",
        libreoffice="office/LibreOffice.app/Contents/MacOS/soffice", fonts=["fonts/YiJieDocumentSans-Regular.ttf", "fonts/YiJieDocumentSans-Bold.ttf"],
        guides=[dict(format=f, path="guides/"+f+".md") for f in ["txt", "md", "html", "csv", "json", "docx", "pptx", "xlsx", "pdf"]],
        limits=dict(generated_file_bytes=10*1024**2, text_source_bytes=1024**2, max_pages=50, max_sheets=10, max_cells=12000, max_visual_tiles=32, max_artifacts=12, step_soft_timeout_seconds=180, job_soft_timeout_seconds=900), files=files)
    destination = ROOT / ".local/document-bundles" / bundle_id
    if not destination.exists():
        destination.parent.mkdir(exist_ok=True)
        shutil.copytree(stage, destination, symlinks=True)
        (destination / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    elif json.loads((destination / "manifest.json").read_text()) != manifest:
        raise ValueError("Sealed bundle conflict")
    receipt = dict(schema_version=1, release=False, bundle_id=bundle_id, bundle_root=str(destination),
        manifest_sha256=digest(destination / "manifest.json"), expanded_bytes=total, file_count=len(files),
        dependency_lock_sha256=digest(LOCK), helper_sha256=digest(ROOT / "document-runtime/helper/document_cli.py"),
        renderer_sha256=digest(renderer), build_recipe_sha256=digest(Path(__file__)), source_commit=subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip())
    (ROOT / ".local/document-bundles/current.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["fetch", "python", "prepare", "assemble", "sources"])
    parser.add_argument("--jobs", type=int, default=4)
    args = parser.parse_args()
    if sys.platform != "darwin" or os.uname().machine != "arm64":
        raise ValueError("This build targets macOS arm64")
    if not 1 <= args.jobs <= 8:
        raise ValueError("jobs must be between 1 and 8")
    lock = json.loads(LOCK.read_text())
    source_id = hashlib.sha256(LOCK.read_bytes()).hexdigest()
    work = ROOT / ".local/document-runtime" / source_id
    downloads = work / "downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    if args.action == "sources":
        sources = work / "sources"
        sources.mkdir(exist_ok=True)
        source_lock = json.loads((ROOT / "document-runtime/sources.lock.json").read_text())
        for entry in source_lock["archives"]:
            path = fetch(sources, entry["url"], entry["sha256"], entry["size_bytes"])
            print("Corresponding source archived: " + path.name, flush=True)
        for package in lock["python_packages"]:
            for artifact in package["upstream_artifacts_metadata_only"]:
                if artifact["kind"] == "sdist":
                    fetch(sources, artifact["url"], artifact["sha256"], artifact["size_bytes"])
                    break
        return
    source = fetch(downloads, lock["cpython"]["source_url"], lock["cpython"]["upstream_source_sha256"])
    wheels = []
    for package in lock["python_packages"]:
        candidates = [a for a in package["upstream_artifacts_metadata_only"] if a["kind"] == "bdist_wheel"]
        # Prefer a universal pure-Python artifact when the locked list has one.
        artifact = next((a for a in candidates if "none-any" in a["filename"]), candidates[0])
        wheels.append((package, fetch(downloads, artifact["url"], artifact["sha256"], artifact["size_bytes"])))
    lo = lock["libreoffice"]
    fetch(downloads, lo["upstream_artifact_url"], lo["upstream_sha256"], lo["upstream_size_bytes"])
    print("Verified pinned sources in " + str(downloads), flush=True)
    if args.action == "fetch":
        return
    src = work / ("Python-" + lock["cpython"]["version"])
    if not src.exists():
        with tarfile.open(source) as archive:
            archive.extractall(work, filter="data")
    stage = work / "stage"
    prefix = stage / "python"
    receipt = work / "python-built.json"
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SDKROOT", "DEVELOPER_DIR")}
    env.update(MACOSX_DEPLOYMENT_TARGET="14.0", PATH="/usr/bin:/bin:/usr/sbin:/sbin", CFLAGS="-O2 -mmacosx-version-min=14.0")
    if not receipt.exists():
        # The document interpreter has no network/package-manager/Tk surface.
        # Explicitly exclude optional non-platform native deps rather than
        # discovering libraries from the build machine's Homebrew prefix.
        (src / "Modules/Setup.local").write_text("*disabled*\n_ssl\n_hashlib\n_tkinter\nreadline\n_lzma\n_dbm\n_gdbm\n")
        if not (src / "Makefile").exists():
            run(["./configure", "--prefix=" + str(prefix), "--disable-shared", "--disable-test-modules", "--without-ensurepip", "--without-static-libpython"], src, env, work / "python-configure.log")
        run(["/usr/bin/make", "-j" + str(args.jobs)], src, env, work / "python-build.log")
        run(["/usr/bin/make", "install"], src, env, work / "python-install.log")
        receipt.write_text(json.dumps({"source_id": source_id, "version": lock["cpython"]["version"]}, indent=2) + "\n")
    elif json.loads(receipt.read_text())["source_id"] != source_id:
        raise ValueError("Python build source changed")
    # --without-ensurepip suppresses bootstrap installation but CPython's
    # standard install still copies the ensurepip wheels and GUI entrypoints.
    # Prune those optional modules only in this owned reproducible build stage.
    # Sealed candidates and all system/third-party executables stay untouched.
    for module in ["ensurepip", "idlelib", "tkinter", "venv"]:
        optional = prefix / "lib/python3.12" / module
        if optional.exists():
            shutil.rmtree(optional)
    for entry in (prefix / "bin").iterdir():
        if entry.name not in ("python3", "python3.12"):
            entry.unlink()
    sites = prefix / "lib/python3.12/site-packages"
    for package, wheel in wheels:
        target = (work / "build-site") if package["scope"] != "runtime" else sites
        marker = work / ("wheel-" + package["name"] + ".json")
        if marker.exists():
            if json.loads(marker.read_text())["sha256"] != digest(wheel):
                raise ValueError("Installed wheel changed")
            continue
        target.mkdir(parents=True, exist_ok=True)
        unpack_wheel(wheel, target)
        marker.write_text(json.dumps({"sha256": digest(wheel)}))
    probe = "import sys,docx,pptx,openpyxl,reportlab,pypdf,defusedxml; assert sys.version_info[:3] == (3,12,16); print(sys.version); print(sys.prefix)"
    run([str(prefix / "bin/python3.12"), "-I", "-B", "-c", probe], work, env, work / "python-probe.log")
    print("Dedicated Python and pinned document packages ready in " + str(prefix), flush=True)
    if args.action in ("prepare", "assemble"):
        prepare_office_and_fonts(work, stage, lock, env)
    if args.action == "assemble":
        assemble(work, stage, lock)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        print("Document runtime build stopped: " + str(error), file=sys.stderr)
        raise SystemExit(1)
