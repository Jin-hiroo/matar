/**
 * Tag detector (ARCHITECTURE.md §4): `createDetector` finds tag36h11 tags in a
 * gray frame and returns their IDs and sub-pixel corners. Its option and
 * result types (`DetectorOptions`, `Detector`, `TagDetection`) live in
 * src/types.ts.
 */
export { createDetector } from './detector.js';
