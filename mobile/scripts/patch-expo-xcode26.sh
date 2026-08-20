#!/usr/bin/env bash
# Expo SDK 57's Swift/C++ interop does not compile under Xcode 26's stricter
# Swift compiler. Two mechanical incompatibilities, both inside
# node_modules/expo-modules-jsi:
#
#   1. `weak let` — Xcode 26 requires weak references to be mutable, and making
#      them `var` then trips Sendable conformance, so they also need
#      `nonisolated(unsafe)` (the same annotation the package already uses on
#      the neighbouring `pointee` properties).
#   2. `SWIFT_RETURNS_RETAINED` on RuntimeScheduler's constructors — only valid
#      on functions returning a SWIFT_SHARED_REFERENCE type.
#
# Re-run after every `npm install`. Remove once Expo ships a fix upstream.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import pathlib, re
root = pathlib.Path("node_modules/expo-modules-jsi/apple")
if not root.exists():
    raise SystemExit("expo-modules-jsi not installed; run npm install first")
n = 0
for f in root.rglob("*.swift"):
    s = orig = f.read_text()
    s = s.replace("weak let", "weak var")
    s = re.sub(r'^(\s*)((?:public |internal |private |fileprivate )?)weak var runtime:',
               lambda m: f"{m.group(1)}nonisolated(unsafe) {m.group(2)}weak var runtime:",
               s, flags=re.M)
    s = s.replace("nonisolated(unsafe) nonisolated(unsafe)", "nonisolated(unsafe)")
    if s != orig:
        f.write_text(s); n += 1
h = root / "Sources/ExpoModulesJSI-Cxx/include/RuntimeScheduler.h"
h.write_text(h.read_text().replace("SWIFT_RETURNS_RETAINED RuntimeScheduler(", "RuntimeScheduler("))
print(f"patched {n} Swift files + RuntimeScheduler.h")
PY
