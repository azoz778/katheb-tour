#!/usr/bin/env python3
"""Deterministic, dependency-free validation for the static Katheb tour demo."""

from __future__ import annotations

import functools
import json
import struct
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
REPRESENTATIVE_ROUTE = "/?q=mobile&view=foyer"
QUALITIES = ("mobile", "medium", "full")

# Runtime files reached by the representative mobile route. The JavaScript and
# WASM decoder files are loaded by three.js, some only after it inspects the GLB.
REQUIRED_STATIC_ASSETS = (
    "index.html",
    "style.css",
    "style_v3.css",
    "style_v4.css",
    "main.js",
    "views.json",
    "collision.json",
    "vendor/three/build/three.module.js",
    "vendor/three/build/three.core.js",
    "vendor/three/addons/controls/PointerLockControls.js",
    "vendor/three/addons/loaders/GLTFLoader.js",
    "vendor/three/addons/loaders/DRACOLoader.js",
    "vendor/three/addons/loaders/KTX2Loader.js",
    "vendor/three/addons/math/ColorSpaces.js",
    "vendor/three/addons/utils/BufferGeometryUtils.js",
    "vendor/three/addons/utils/SkeletonUtils.js",
    "vendor/three/addons/utils/WorkerPool.js",
    "vendor/three/addons/libs/ktx-parse.module.js",
    "vendor/three/addons/libs/zstddec.module.js",
    "vendor/three/addons/libs/basis/basis_transcoder.js",
    "vendor/three/addons/libs/basis/basis_transcoder.wasm",
    "vendor/three/addons/libs/draco/gltf/draco_decoder.js",
    "vendor/three/addons/libs/draco/gltf/draco_wasm_wrapper.js",
    "vendor/three/addons/libs/draco/gltf/draco_decoder.wasm",
)


class ValidationError(Exception):
    """Raised when the checked-in demo is internally inconsistent."""


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *args: object) -> None:
        pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def load_json(relative_path: str) -> object:
    try:
        return json.loads((ROOT / relative_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValidationError(f"cannot read {relative_path}: {error}") from error


def checked_repo_path(relative_path: str) -> Path:
    posix_path = PurePosixPath(relative_path)
    require(
        not posix_path.is_absolute() and ".." not in posix_path.parts,
        f"unsafe repository-relative path: {relative_path!r}",
    )
    path = ROOT.joinpath(*posix_path.parts)
    require(path.is_file(), f"required file is missing: {relative_path}")
    return path


def validate_tour_data() -> tuple[dict[str, object], dict[str, object]]:
    views = load_json("views.json")
    collision = load_json("collision.json")
    require(isinstance(views, dict), "views.json must contain an object")
    require(isinstance(collision, dict), "collision.json must contain an object")

    view_map = views.get("views")
    order = views.get("order")
    spawn = views.get("spawn")
    builds = views.get("builds")
    require(isinstance(view_map, dict) and view_map, "views.json needs named views")
    require(isinstance(order, list) and order, "views.json needs a non-empty order")
    require(len(order) == len(set(order)), "views.json order contains duplicates")
    require(all(name in view_map for name in order), "order references an unknown view")
    require(spawn in view_map, "spawn references an unknown view")
    require("foyer" in view_map, "representative foyer view is missing")
    require(isinstance(builds, dict), "views.json needs a builds object")
    require(all(quality in builds for quality in QUALITIES), "a quality build is missing")

    try:
        x0 = float(collision["x0"])
        y0 = float(collision["y0"])
        resolution = float(collision["res"])
        nx = int(collision["nx"])
        ny = int(collision["ny"])
        rows = collision["rows"]
    except (KeyError, TypeError, ValueError) as error:
        raise ValidationError(f"invalid collision metadata: {error}") from error
    require(resolution > 0 and nx > 0 and ny > 0, "collision dimensions must be positive")
    require(isinstance(rows, list) and len(rows) == ny, "collision row count != ny")
    require(all(isinstance(row, str) and len(row) == nx for row in rows), "collision row width != nx")
    require(set("".join(rows)) <= set("012"), "collision rows contain an unknown cell value")

    # A view that is outside the grid or on a blocked cell makes a route load but
    # leaves the user stuck. Check every currently advertised jump target.
    for name in order:
        view = view_map[name]
        require(isinstance(view, dict), f"view {name!r} must be an object")
        position = view.get("pos")
        require(
            isinstance(position, list)
            and len(position) == 2
            and all(isinstance(value, (int, float)) for value in position),
            f"view {name!r} has an invalid position",
        )
        i = int((position[0] - x0) // resolution)
        j = int((position[1] - y0) // resolution)
        require(0 <= i < nx and 0 <= j < ny, f"view {name!r} is outside the collision grid")
        require(rows[j][i] == "0", f"view {name!r} starts on a blocked collision cell")

    return views, collision


def read_glb_document(relative_path: str) -> dict[str, object]:
    path = checked_repo_path(relative_path)
    with path.open("rb") as stream:
        header = stream.read(12)
        require(len(header) == 12, f"truncated GLB header: {relative_path}")
        magic, version, declared_length = struct.unpack("<4sII", header)
        require(magic == b"glTF", f"invalid GLB magic: {relative_path}")
        require(version == 2, f"unsupported GLB version in {relative_path}: {version}")
        require(declared_length == path.stat().st_size, f"GLB length mismatch: {relative_path}")

        chunk_header = stream.read(8)
        require(len(chunk_header) == 8, f"missing GLB JSON chunk: {relative_path}")
        chunk_length, chunk_type = struct.unpack("<I4s", chunk_header)
        require(chunk_type == b"JSON", f"first GLB chunk is not JSON: {relative_path}")
        try:
            document = json.loads(stream.read(chunk_length))
        except json.JSONDecodeError as error:
            raise ValidationError(f"invalid GLB JSON in {relative_path}: {error}") from error
    require(isinstance(document, dict), f"GLB JSON must be an object: {relative_path}")
    return document


def validate_builds(views: dict[str, object]) -> dict[str, Path]:
    builds = views["builds"]
    assert isinstance(builds, dict)
    resolved: dict[str, Path] = {}
    for quality in QUALITIES:
        relative_path = builds[quality]
        require(isinstance(relative_path, str), f"{quality} build path must be a string")
        path = checked_repo_path(relative_path)
        document = read_glb_document(relative_path)
        required_extensions = set(document.get("extensionsRequired", []))
        require(
            "KHR_draco_mesh_compression" in required_extensions,
            f"{quality} build no longer matches the checked-in Draco runtime boundary",
        )
        if quality in {"mobile", "medium"}:
            require(
                "KHR_texture_basisu" in required_extensions,
                f"{quality} build no longer matches the checked-in KTX2 runtime boundary",
            )
        external_uris = [
            item["uri"]
            for collection in ("buffers", "images")
            for item in document.get(collection, [])
            if isinstance(item, dict) and "uri" in item
        ]
        require(not external_uris, f"{quality} GLB has untracked external resources: {external_uris}")
        resolved[quality] = path
    return resolved


def http_request(base_url: str, route: str, *, method: str = "GET") -> tuple[bytes, int]:
    request = Request(base_url + route, method=method)
    try:
        with urlopen(request, timeout=10) as response:
            return response.read(), int(response.headers.get("Content-Length", "-1"))
    except (HTTPError, URLError, TimeoutError) as error:
        raise ValidationError(f"{method} {route} failed: {error}") from error


def validate_served_route(mobile_build: Path) -> int:
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base_url = f"http://127.0.0.1:{server.server_port}"
    try:
        page, _ = http_request(base_url, REPRESENTATIVE_ROUTE)
        html = page.decode("utf-8")
        require('<script type="module" src="main.js"></script>' in html, "route omits main.js")
        require('"three": "./vendor/three/build/three.module.js"' in html, "route omits the three.js import map")

        served_assets = list(REQUIRED_STATIC_ASSETS) + [str(mobile_build.relative_to(ROOT))]
        for relative_path in served_assets:
            path = checked_repo_path(relative_path)
            _, content_length = http_request(base_url, "/" + quote(relative_path), method="HEAD")
            require(content_length == path.stat().st_size, f"served length mismatch: {relative_path}")
        return len(served_assets)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def main() -> int:
    try:
        views, collision = validate_tour_data()
        builds = validate_builds(views)
        served_count = validate_served_route(builds["mobile"])
    except (ValidationError, OSError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1

    print(f"PASS route {REPRESENTATIVE_ROUTE}")
    print(
        "PASS tour data "
        f"({len(views['views'])} views, {collision['nx']}x{collision['ny']} collision grid)"
    )
    print(f"PASS {len(builds)} embedded GLB builds")
    print(f"PASS {served_count} required static assets")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
