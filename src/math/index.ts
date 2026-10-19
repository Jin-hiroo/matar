/**
 * Small dense linear algebra for matar (float64): 3×3 (`Mat3`, row-major) and
 * 4×4 (`Mat4`, column-major) helpers, rotations and quaternions, Jacobi SVD /
 * symmetric eigen, Cholesky, Levenberg–Marquardt and homographies. Internal,
 * reusable by other workstreams; not part of the public `matar` API.
 */
export * from './mat3.js';
export * from './mat4.js';
export * from './rotation.js';
export * from './svd.js';
export * from './cholesky.js';
export * from './homography.js';
export * from './lm.js';
