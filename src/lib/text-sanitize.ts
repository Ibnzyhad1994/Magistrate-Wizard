/**
 * Unicode/text sanitization boundary — the ONE place extracted or pasted
 * document text passes through before it can reach Supabase (any text/
 * jsonb column) or the extraction quality gate.
 *
 * ROOT CAUSE of the observed "unsupported Unicode sequence" failures
 * (Magistrate Wizard holistic ingestion repair pass): the dependency-free PDF
 * parser decodes raw PDF bytes as latin1 (byte-for-byte, so every byte
 * 0x00-0xFF becomes one JS UTF-16 code unit — see pdf-text-extraction.ts).
 * When a stream this parser mistakenly treats as text is actually binary
 * data (embedded font program bytes, compressed object-stream data,
 * etc. — see the stream-classification fix in pdf-text-extraction.ts),
 * that binary data commonly contains raw 0x00 (NUL) bytes. A NUL byte
 * survives latin1 decoding as a literal U+0000 code point embedded in an
 * otherwise normal-looking JS string — and PostgreSQL's `text` type (and,
 * separately, `jsonb`, which rejects it with the literal error message
 * "unsupported Unicode escape sequence") cannot store U+0000 at all. This
 * is NOT a surrogate-pair bug from this parser (it never emits multi-byte
 * UTF-16 sequences, so it cannot itself produce an unpaired surrogate) —
 * but this sanitizer defends against BOTH failure modes anyway, since
 * curator-pasted text (copied from a browser PDF viewer, a scanned-OCR
 * tool, or any other clipboard source) is a completely different input
 * path that genuinely can contain corrupted/unpaired surrogates.
 *
 * This is deliberately NOT a "flatten to ASCII" transform — legitimate
 * legal-document Unicode (curly quotes, en/em dashes, the section symbol
 * §, pilcrow ¶, degree sign, accented names common in Caribbean/French/
 * Portuguese-derived surnames, etc.) is preserved untouched. Only
 * characters PostgreSQL/JSON genuinely cannot store, or that are never
 * legitimate in prose (control characters), are removed.
 */

export interface SanitizeResult {
  /** The cleaned text — safe to send to Supabase/Postgres as `text` or inside `jsonb`. */
  text: string;
  /** Total characters removed across every category below. 0 means the input was already clean. */
  removedCount: number;
  hadNulBytes: boolean;
  hadInvalidSurrogates: boolean;
  hadOtherControlChars: boolean;
}

/**
 * Removes characters PostgreSQL/JSON cannot accept, or that are never
 * legitimate prose content, while leaving every other code point —
 * including the full range of accented Latin, general punctuation, and
 * symbol blocks used in real legal documents — untouched.
 *
 * Iterates by Unicode CODE POINT (`for...of` on a string), not by UTF-16
 * code unit, so a valid surrogate PAIR (e.g. an emoji or rare CJK
 * character, however unlikely in a Caribbean law report) is correctly
 * combined and preserved; only an UNPAIRED surrogate — which cannot occur
 * in valid Unicode text and cannot be stored by Postgres — is dropped.
 */
export function sanitizeExtractedText(input: string): SanitizeResult {
  let out = "";
  let removedCount = 0;
  let hadNulBytes = false;
  let hadInvalidSurrogates = false;
  let hadOtherControlChars = false;

  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;

    // NUL — PostgreSQL cannot store this in `text` or `jsonb` at all
    // ("unsupported Unicode escape sequence" is the literal jsonb error).
    if (code === 0) {
      hadNulBytes = true;
      removedCount += 1;
      continue;
    }

    // Unpaired surrogate (0xD800-0xDFFF surviving as its own iteration
    // step means it did NOT combine into a valid pair) — not valid
    // Unicode text, cannot be safely stored or round-tripped as UTF-8.
    if (code >= 0xd800 && code <= 0xdfff) {
      hadInvalidSurrogates = true;
      removedCount += 1;
      continue;
    }

    // Other C0/C1 control characters, excluding the three that are
    // legitimate in prose: tab (0x09), line feed (0x0A), carriage
    // return (0x0D).
    const isC0Control =
      (code >= 0x01 && code <= 0x08) || code === 0x0b || code === 0x0c || (code >= 0x0e && code <= 0x1f);
    const isC1Control = code >= 0x7f && code <= 0x9f;
    if (isC0Control || isC1Control) {
      hadOtherControlChars = true;
      removedCount += 1;
      continue;
    }

    out += ch;
  }

  return { text: out, removedCount, hadNulBytes, hadInvalidSurrogates, hadOtherControlChars };
}
