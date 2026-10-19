# matar

**Browser AR for printed paper mats.** Print a sheet with square ID tags,
point a phone at it, and draw three.js content that stays put on the paper,
in iPhone Safari and Android Chrome alike. No WebXR, no flags, no app, no server.

> Status: early development (v0.0). Not usable yet.

## How it works

1. You describe a **board**: which tags are printed where (mm).
2. matar opens the rear camera, finds the tags in each frame (in a Web Worker),
   and computes the camera's pose relative to the paper.
3. `matar/three` puts the camera video behind your scene and moves a three.js
   camera to match, frame by frame.

Everything runs on the phone. matar makes no network requests and never
uploads camera frames. The library is a few tens of KB with zero runtime
dependencies (`three` is an optional peer).

## Docs

- [Spec](docs/SPEC.md): features, API shape, budgets, limitations
- [Architecture](docs/ARCHITECTURE.md): frames, pipeline, algorithms
- [Tasks](docs/TASKS.md): roadmap
- [Device tests](docs/DEVICE-TESTS.md)

## Licence

[Apache-2.0](LICENSE). Includes the AprilTag tag36h11 code table (BSD-2-Clause, University of Michigan); see [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).
