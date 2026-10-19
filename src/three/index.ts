/**
 * `matar/three`: the three.js adapter (ARCHITECTURE.md §7, §8). Peer
 * dependency `three ≥ 0.173`; the core never imports three.js.
 */
export {
  MatarThree,
  type MatarThreeOptions,
  type MatarThreeRenderer,
  type MatarThreeUpdate,
} from './matar-three.js';
export { mmToM } from './units.js';
