"""Build/update the small, fixed local launcher; never package the desktop app."""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
IDENTIFIER = "ai.yijie.development-entry"


def install():
    output = ROOT / ".local/development/launcher"
    app = output / "易界.app"
    receipt = output / "build.json"
    executable = app / "Contents/MacOS/YijieDevelopmentEntry"
    python = shutil.which("python3")
    pnpm = shutil.which("pnpm")
    if not python or not pnpm:
        raise ValueError("Python/pnpm must already be installed")
    docker = next(p for p in [Path.home() / "Applications/Docker.app", Path("/Applications/Docker.app")]
                  if (p / "Contents/Resources/bin/docker").is_file())
    tool_paths = list(dict.fromkeys([str(Path(pnpm).parent), str(Path(python).parent),
                                   str(Path.home() / ".cargo/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]))
    info = {"CFBundleIdentifier": IDENTIFIER, "CFBundleExecutable": executable.name,
            "CFBundleName": "易界", "CFBundleDisplayName": "易界", "CFBundlePackageType": "APPL",
            "CFBundleVersion": "1", "CFBundleShortVersionString": "1.0", "CFBundleIconFile": "icon.icns",
            "NSHighResolutionCapable": True, "LSMinimumSystemVersion": "13.0", "LSMultipleInstancesProhibited": True,
            "NSSupportsAutomaticTermination": False, "NSSupportsSuddenTermination": False,
            "YijieProjectRoot": str(ROOT), "YijiePython": python, "YijieDockerApp": str(docker),
            "YijieToolPath": os.pathsep.join(tool_paths)}
    source = ROOT / "scripts/development-entry.swift"
    config = plistlib.dumps(info, sort_keys=True)
    digest = hashlib.sha256(source.read_bytes() + config).hexdigest()
    if app.exists():
        old = json.loads(receipt.read_text())
        if old.get("project") != str(ROOT) or old.get("identifier") != IDENTIFIER or hashlib.sha256(executable.read_bytes()).hexdigest() != old["binary_sha256"]:
            raise ValueError("Existing launcher is not the recorded project output; left untouched")
        rows = subprocess.check_output(["ps", "-axo", "comm="], text=True).splitlines()
        if str(executable) in rows:
            raise ValueError("Quit the launcher normally before updating its build")
    else:
        old = {}
    output.mkdir(parents=True, exist_ok=True)
    if old.get("source_sha256") != digest:
        executable.parent.mkdir(parents=True, exist_ok=True)
        (app / "Contents/Resources").mkdir(exist_ok=True)
        temporary = output / "YijieDevelopmentEntry.building"
        subprocess.run(["xcrun", "swiftc", "-O", "-module-cache-path", str(output / "module-cache"),
                        str(source), "-o", str(temporary)], check=True)
        temporary.replace(executable)
        (app / "Contents/Info.plist").write_bytes(config)
        shutil.copyfile(ROOT / "src-tauri/icons/icon.icns", app / "Contents/Resources/icon.icns")
        receipt.write_text(json.dumps({"project": str(ROOT), "identifier": IDENTIFIER, "source_sha256": digest,
                                       "binary_sha256": hashlib.sha256(executable.read_bytes()).hexdigest()}, indent=2) + "\n")
    for link in [Path.home() / "Applications/易界.app", Path.home() / "Desktop/易界.app"]:
        if link.is_symlink() and link.resolve() == app:
            continue
        if link.exists() or link.is_symlink():
            raise ValueError("Existing user entry left untouched: " + str(link))
        link.symlink_to(app, target_is_directory=True)
    print("Fixed launcher installed:", Path.home() / "Desktop/易界.app")
    print("Only this project-owned launcher was built; no desktop package or data copy.")


if __name__ == "__main__":
    install()
