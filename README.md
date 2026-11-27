# KATHEB Type 01 — walkable apartment tour

This repository is a static Three.js demo of the KATHEB Type 01 apartment. It
contains 17 named jump views covering the apartment and lift lobby, a collision
grid, and three embedded-resource GLB variants of the same model. Lighting is
baked with Cycles and the scene includes a Riyadh window view.

## Local validation

Requirements: Python 3 and Make. No package install or network access is needed.

```sh
make validate
```

The command starts a temporary server bound to loopback on an available port,
requests the representative route `/?q=mobile&view=foyer`, and checks that its
HTML and required static dependencies are served. It also validates every named
view against `collision.json` and inspects all three GLB containers for valid
headers, embedded resources, and their declared Draco/KTX2 decoder boundaries.
It exits non-zero with the first actionable inconsistency.

This is a deterministic static/integration baseline. It does **not** render the
scene, measure visual fidelity or performance, or replace browser/WebGL testing.

## Current routes and assets

There is one document route, `/` (or `/index.html`). Query parameters select its
runtime state; there are no server-side routes:

- `q=mobile|medium|full` forces a model variant; otherwise device/GPU heuristics
  choose one.
- `view=<name>` selects a key from `views.json`; `foyer` is the configured spawn.
- `shot`, `fov=<number>`, `b=<number>`, and `noauto` control capture styling,
  field of view, brightness, and automatic exposure.
- `glb=<path>` overrides the model URL. This is a demo/debug input, not a safe
  public upload or asset-selection API.

The document loads `main.js`, three CSS files, the vendored Three.js ES modules,
`views.json`, and `collision.json`. `views.json` maps the three qualities to:

| Quality | Model | Current declared size | Runtime requirement |
| --- | --- | ---: | --- |
| mobile | `assets/katheb_v3_apartment_mobile.glb` | 26.5 MB | Draco + KTX2/Basis |
| medium | `assets/katheb_v3_apartment_medium.glb` | 46.7 MB | Draco + KTX2/Basis |
| full | `assets/katheb_v3_apartment.glb` | 92.4 MB | Draco |

All model textures and buffers are embedded in their GLB. Decoder JavaScript
and WASM files are vendored under `vendor/three/addons/libs/`. Because browser
module loading and `fetch()` require HTTP semantics, opening `index.html`
directly with `file://` is outside the supported runtime boundary.

## Demo boundary and known gaps

Everything checked in here is demo-only: the static viewer, Type 01 scene,
quality-selection heuristics, navigation coordinates, collision data, baked
assets, credits, and validation command. The repository contains no application
backend, authentication, analytics, content management, deployment workflow,
production configuration, or commissioned-client acceptance criteria. It also
contains no evidence that branding, copy, floor-plan accuracy, accessibility,
device/browser support, visual quality, or performance budgets have been
approved for a commissioned delivery. Those dependencies must be supplied and
accepted separately; this demo must not be represented as that delivery.

Known validation gaps are real-browser rendering, WebGL/decoder execution,
interaction tests, accessibility checks, and performance budgets. The next
smallest non-public milestone is a local headless-browser smoke test for the
mobile `foyer` route that waits for the scene-ready signal and asserts that the
configured model loads without console or network errors. That milestone should
remain local/CI-only until commissioned scope and public-launch approval exist.

## Credits

Window view “Riyadh aerial helicam 2013” by Ville Hyvonen, CC BY-SA 2.0
(Wikimedia Commons); textures and scanned props from Poly Haven and ambientCG
(CC0); artworks from The Metropolitan Museum of Art Open Access (CC0); Three.js
(MIT).
