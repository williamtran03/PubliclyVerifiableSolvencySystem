#!/usr/bin/env python3

import argparse
import base64
import hashlib
import io
import os
from pathlib import Path
import platform
import re
import subprocess
import tarfile
import tempfile
import urllib.request

TOOLS = (
    {
        "name": "nargo",
        "version": "1.0.0-beta.26",
        "archive": "opensolvency-nargo-beta26.tar.gz",
        "url": "https://github.com/noir-lang/noir/releases/download/v1.0.0-beta.26/nargo-x86_64-unknown-linux-gnu.tar.gz",
        "member": "nargo",
        "sha256": "64048040befd55a987158b11137d8f38f9688f696db4d84910dd1bcf0442fb80",
    },
    {
        "name": "bb",
        "version": "6.0.0-nightly.20260902",
        "archive": "opensolvency-bb-nightly20260902.tgz",
        "url": "https://registry.npmjs.org/@aztec-foundation/bb-linux-x64/-/bb-linux-x64-6.0.0-nightly.20260902.tgz",
        "member": "package/bin/bb",
        "sha512": "9sRypGOZv9vyO5h6P9ogJPgbp+9MtnNDJAdHKGSls5+bsCuQ6rT9Tv9d2DqaiXP0JuQ6TAk6lkZBlWHn6HQKHw==",
    },
)


def main():
    parser = argparse.ArgumentParser(description="Install the committed verifier's pinned Linux x86_64 proving tools.")
    parser.add_argument("--archive-dir", type=Path, help="Use already downloaded, checksum-verified archives instead of network downloads")
    parser.add_argument("--destination", type=Path, default=Path.home() / ".local/share/opensolvency/proving-tools/bin")
    args = parser.parse_args()
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        parser.error("This installer supports Linux x86_64; use matching official releases on other platforms.")
    args.destination.mkdir(parents=True, exist_ok=True)
    for tool in TOOLS:
        if args.archive_dir:
            archive = (args.archive_dir / tool["archive"]).read_bytes()
        else:
            with urllib.request.urlopen(tool["url"], timeout=120) as response:
                archive = response.read()
        if "sha256" in tool:
            valid = hashlib.sha256(archive).hexdigest() == tool["sha256"]
        else:
            valid = base64.b64encode(hashlib.sha512(archive).digest()).decode() == tool["sha512"]
        if not valid:
            raise RuntimeError(f"{tool['name']}: archive checksum mismatch; nothing from this archive was installed.")
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as package:
            member = package.getmember(tool["member"])
            if not member.isfile():
                raise RuntimeError("The expected binary is not a regular file.")
            binary = package.extractfile(member).read()
        fd, staging = tempfile.mkstemp(prefix=f".{tool['name']}-", dir=args.destination)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(binary)
            os.chmod(staging, 0o755)
            version = subprocess.check_output([staging, "--version"], text=True)
            actual = re.search(r"\d+\.\d+\.\d+(?:-[\w.]+)?", version)
            if not actual or actual.group() != tool["version"]:
                raise RuntimeError(f"{tool['name']}: unexpected installed version.")
            os.replace(staging, args.destination / tool["name"])
        finally:
            if os.path.exists(staging):
                os.unlink(staging)
        print(f"Installed {tool['name']} {tool['version']} in {args.destination}")
    print("Add this directory to PATH before running proof generation; no shell startup files were modified.")


if __name__ == "__main__":
    main()
