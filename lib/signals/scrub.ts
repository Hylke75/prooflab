// Removes the most common personal data from free text before it becomes a source fragment: e-mail
// addresses, phone numbers, URLs, @handles and everything from a closing line ("Met vriendelijke groet",
// "Groet,", "Best regards") onwards, because names and job titles sit in the signature. Names in the body
// itself cannot be found reliably; the consultant still confirms that the text holds no personal data.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL = /\b(?:https?:\/\/|www\.)[^\s<>()]*[^\s<>().,;:!?'"]/gi;
const HANDLE = /(^|[\s(])@[A-Za-z0-9_](?:[A-Za-z0-9_.-]*[A-Za-z0-9_])+/g;
// International or Dutch numbers with at least 9 digits, allowing spaces, dots, dashes and brackets.
const PHONE = /(?<![\w€$])(?:\+|00)?\d[\d\s().-]{7,}\d(?![\w%])/g;
const CLOSING =
  /^\s*(?:met\s+)?(?:vriendelijke|hartelijke|beste|warme)\s+groet(?:en)?\b|^\s*(?:groet(?:en|jes)?|mvg|gr\.?)\s*[,.!]?\s*$|^\s*(?:kind|best|warm)\s+regards\b|^\s*(?:regards|cheers|thanks|bedankt|dank)\s*[,.!]?\s*$|^\s*(?:sent from my|verzonden vanaf mijn)\b/im;

export const REDACTED = {
  email: "[e-mailadres]",
  url: "[link]",
  handle: "[account]",
  phone: "[telefoonnummer]",
} as const;

export type ScrubResult = { text: string; removed: { email: number; url: number; handle: number; phone: number; signature: boolean } };

function digits(s: string) {
  return s.replace(/\D/g, "").length;
}

export function scrubPersonalData(input: string): ScrubResult {
  const removed = { email: 0, url: 0, handle: 0, phone: 0, signature: false };
  let text = input;

  const closing = CLOSING.exec(text);
  if (closing && closing.index > 0) {
    text = text.slice(0, closing.index).trimEnd();
    removed.signature = true;
  }

  text = text.replace(EMAIL, () => {
    removed.email++;
    return REDACTED.email;
  });
  text = text.replace(URL, () => {
    removed.url++;
    return REDACTED.url;
  });
  text = text.replace(HANDLE, (_, pre: string) => {
    removed.handle++;
    return `${pre}${REDACTED.handle}`;
  });
  text = text.replace(PHONE, (m) => {
    // Amounts, years and dates have fewer digits or separators that make them unlike a phone number.
    if (digits(m) < 9 || /^\d{1,3}([.,]\d{3})+$/.test(m.trim())) return m;
    removed.phone++;
    return REDACTED.phone;
  });

  return { text: text.trim(), removed };
}

export function scrubAll(texts: string[]): { texts: string[]; changed: number } {
  let changed = 0;
  const out = texts
    .map((t) => {
      const r = scrubPersonalData(t);
      if (r.text !== t.trim()) changed++;
      return r.text;
    })
    .filter((t) => t.length > 0);
  return { texts: out, changed };
}
