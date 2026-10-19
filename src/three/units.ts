/**
 * Units boundary of `matar/three` (ARCHITECTURE.md §7): the core works in
 * millimetres, three.js scenes in metres. This is the only place in matar that
 * knows metres; every mm → m conversion goes through `mmToM`.
 */

/** Metres per millimetre: three.js length = matar length (mm) × `mmToM`. */
export const mmToM = 0.001;
