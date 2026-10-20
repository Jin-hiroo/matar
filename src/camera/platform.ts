/**
 * Platform classification for lens selection (ARCHITECTURE.md §6.1):
 * iOS/iPadOS WebKit, Android, or anything else.
 *
 * Input: the user-agent string and `navigator.maxTouchPoints` (iPadOS reports
 * a desktop "Macintosh" user agent but has touch points). Output: a
 * `Platform`. Every browser on iOS is WebKit, so Chrome/Firefox on iOS count as
 * `'ios'` too.
 *
 * `detectPlatform` is pure; `currentPlatform` reads `navigator` inside the
 * function (no browser globals at module top level).
 */

export type Platform = 'ios' | 'android' | 'other';

/** Classifies a user agent (pure). */
export function detectPlatform(userAgent: string, maxTouchPoints = 0): Platform {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return 'ios';
  if (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1) return 'ios'; // iPadOS desktop UA
  if (/\bAndroid\b/i.test(userAgent)) return 'android';
  return 'other';
}

/** The platform of the running browser; `'other'` when there is no `navigator`. */
export function currentPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  return detectPlatform(navigator.userAgent ?? '', navigator.maxTouchPoints ?? 0);
}
