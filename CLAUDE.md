# CLAUDE.md — matar

**matar** is an open-source TypeScript library for **browser AR on a printed
paper mat**. You print a sheet with square ID tags at known positions; the
library finds those tags in the phone's camera video, works out where the camera
is relative to the paper, and lets three.js draw content registered to it. It
runs in **iOS Safari and Android Chrome** using only standard web APIs: no
WebXR, no flags, no app, no server.

Its first consumer is ExhibitAR (a separate, possibly private app). Nothing in
this repo may depend on or mention ExhibitAR internals.

Read these before working:

- `docs/SPEC.md`: what the library does, public API, budgets, non-goals
- `docs/ARCHITECTURE.md`: frames, units, pipeline, algorithms, worker protocol, testing
- `docs/TASKS.md`: workstreams, owned directories, order, acceptance criteria
- `docs/RESEARCH.md`: sourced findings behind the design (browser support, tag
  families, licences). Check it before re-researching something.

If these docs and the code disagree, stop and ask; don't silently pick one.

## Core ideas (never violate)

1. **Camera frames never leave the device.** The library makes no network
   requests: no telemetry, no CDN, no lazy-loaded models. Everything it needs
   ships inside the package. The one fetch is its own worker chunk, emitted by
   the integrator's bundler and loaded from the page's origin.
2. **Standard web only.** `getUserMedia`, Canvas/WebGL, Web Workers, (optionally)
   WebAssembly. Must work in iOS Safari 17+ and current Android Chrome with no
   flags. Never require WebXR, native code, or cross-origin isolation.
3. **The board is the world.** Tracking uses only the printed tags. No SLAM, no
   object recognition, no natural-feature tracking.
4. **Small and predictable.** Zero runtime dependencies. `three` is an optional
   peer dependency used only by `matar/three`. Size budgets in SPEC.md are
   enforced by `pnpm size`. Never add a dependency without updating SPEC.md.
5. **Frames and units are fixed** (ARCHITECTURE.md §2):
   - Board frame: right-handed, **Y up**, paper on the **XZ** plane, **+X to the
     right**, **+Z toward the bottom edge of the printed page** (the "front").
   - Core units: **millimetres** everywhere. `matar/three` converts to metres at
     one named boundary (`mmToM`).
   - Camera: OpenCV convention internally (+X right, +Y down, +Z forward). The
     public pose uses the three.js/OpenGL camera convention (−Z forward, +Y up).
     Convert only in `src/pose/frames.ts`. (Exception: `src/synth` keeps its
     own projection maths as the independent test oracle.)
   - Pixels: pixel centres at **integer** coordinates; the image spans
     [−0.5, w − 0.5].
6. **Generic.** No app concepts (exhibits, users, auth, storage). A consumer
   describes its board as data; the library returns poses.
7. **Testable without a phone.** Every vision and maths stage is a pure function
   on typed arrays, tested against synthetic images rendered at known camera
   poses (`src/synth/`). A stage isn't done until its synthetic test passes with
   the tolerances in TASKS.md.

## Stack

TypeScript 5.9 (strict, ESM only) · Vitest · Playwright (fake-camera e2e) ·
Vite (demo app only) · three.js (optional peer, `matar/three` only) · size-limit.

## Commands

```bash
pnpm install
pnpm test          # vitest (unit + synthetic)
pnpm test:e2e      # playwright: the demo with a fake camera video, and the WebGL texture-ring test
pnpm bench         # vitest bench (tests/bench, timings reported, not gated)
pnpm lint && pnpm typecheck
pnpm build         # tsc → dist/
pnpm size          # build + bundle-size budget check
pnpm dev           # demo app (vite, https via basic-ssl for phones on the LAN)
```

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess`; no `any`; no non-null `!`
  without a comment saying why it holds.
- No browser globals (`window`, `document`, `navigator`, `Worker`,
  `VideoFrame`, `screen`) at module top level: touch them only inside
  functions, so importing `matar` works in Node and server-side rendering.
- Shared types live in `src/types.ts`. Changing them affects every workstream:
  do it deliberately and say so in the commit message.
- Put units in names: `sizeMm`, `fovDeg`, `errPx`, `dtMs`.
- Name transforms `aFromB` (maps B coordinates into A), like `boardFromCamera`.
- Hot paths (per-frame code in `detect/`, `pose/`, `camera/`, `worker/`) use
  typed arrays and preallocated buffers: no per-frame allocation in inner loops,
  no closures created per pixel, no `Array.prototype.map` over pixels.
- Matrices: `Mat3` row-major, `Mat4` column-major (three.js order). Say which in
  every doc comment that takes one.
- Each module gets a short header comment: what it does, its inputs/outputs and
  their units/frames, and the paper or reference implementation it follows.
- Third-party code tables or ported algorithms: record the source and licence in
  `THIRD_PARTY_NOTICES` and in the file header (as a `/*! @license … */` comment
  so minifiers keep it). Only permissive licences (MIT, BSD, Apache-2.0).
  Never copy GPL code (for example the UCO ArUco library).
- Small, focused commits (Conventional Commits: `feat(detect): …`). Each task in
  TASKS.md is completable and testable on its own; tick its checkbox when done.
- Python tooling, if ever needed: always in a `.venv`; never install globally.

## Working in parallel (sessions / subagents)

Work is split into workstreams with **owned directories** (TASKS.md). Stay inside
yours. If you need something from another workstream, code against
`src/types.ts` and stub it until the real implementation lands.

Parallel agents each use their own git worktree and branch:

```bash
git -C ~/dev/matar worktree add ../matar.worktrees/<task> -b <type>/<task> main
cd ../matar.worktrees/<task> && pnpm install --frozen-lockfile
```

Don't edit `package.json`, `pnpm-lock.yaml` or `src/types.ts` from a parallel
branch unless the task says so; propose the change in your report instead.

## Device testing

Claude can't run a phone. Correctness is shown with synthetic tests and the
fake-camera e2e test; real-device behaviour (iPhone Safari, Android Chrome) is
checked by the maintainer using the demo app and `docs/DEVICE-TESTS.md`. Never
claim something works on a device unless a device result is recorded there.

## Open-source hygiene

This repo is meant to be public. Never commit secrets, personal data, private
URLs, or project IDs of other apps. Test images are synthetic or generated.
