/**
 * Copy rules as code — SPEC §7B.10, BRAND.md voice.
 *
 * Verb first. Present tense. Second person. One idea per sentence. Never
 * apologize. Never "simply", "just", or "easy" — the user is holding a phone
 * against a wall in a dusty room and nothing about that is simple. State the
 * action, then the reason, in that order.
 *
 * The mechanical half of those rules is enforceable and enforced here: the
 * guidance test suite runs every string in this package through
 * `voiceViolations`. The judgment half (verb first, one idea) is a review
 * rule, restated in docs/guidance-notes.md for contributors.
 */

export const FORBIDDEN_VOICE_WORDS = ['simply', 'just', 'easy', 'sorry', 'please'] as const;

const FORBIDDEN_RE = new RegExp(`\\b(${FORBIDDEN_VOICE_WORDS.join('|')})\\b`, 'gi');

/** Returns every forbidden word found in the text (lowercased), empty when clean. */
export function voiceViolations(text: string): string[] {
  const found = text.match(FORBIDDEN_RE) ?? [];
  return found.map((w) => w.toLowerCase());
}
