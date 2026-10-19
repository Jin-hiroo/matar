/**
 * Public entry point `matar` (ARCHITECTURE.md §8). Wired by the lead: each
 * workstream exports from its own `src/<dir>/index.ts`; only the lead edits
 * this file.
 */
export type * from './types.js';
export { DEFAULT_FAMILY, getFamily, tagCells } from './tags/index.js';
