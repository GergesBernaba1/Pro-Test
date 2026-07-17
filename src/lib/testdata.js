// "Bug Magnet" style catalog of test data. These strings are designed to shake
// out common input-handling bugs (validation, encoding, overflow, injection).
// Nothing here is malicious — the XSS/SQL strings are inert probes a tester
// pastes into their OWN app to check that inputs are escaped/validated.

export const TEST_DATA = {
  "Empty & whitespace": [
    { label: "Empty string", value: "" },
    { label: "Single space", value: " " },
    { label: "Tabs & newlines", value: "\t\n\t" },
    { label: "Leading/trailing spaces", value: "   hello   " },
  ],
  "Long text": [
    { label: "256 chars", value: "a".repeat(256) },
    { label: "1,000 chars", value: "Lorem ipsum ".repeat(84).slice(0, 1000) },
    { label: "5,000 chars", value: "x".repeat(5000) },
    { label: "No spaces (wrap test)", value: "supercalifragilistic".repeat(30) },
  ],
  Numbers: [
    { label: "Zero", value: "0" },
    { label: "Negative", value: "-1" },
    { label: "Large integer", value: "999999999999999" },
    { label: "Float precision", value: "0.1000000000000001" },
    { label: "Scientific", value: "1e10" },
    { label: "Leading zeros", value: "0000123" },
    { label: "Comma-separated", value: "1,234,567" },
  ],
  "Special characters": [
    { label: "Symbols", value: "!@#$%^&*()_+-={}[]|\\:;\"'<>,.?/~`" },
    { label: "Quotes mix", value: "\"'`‘’“”" },
    { label: "Emoji", value: "😀🚀🔥✅🇬🇧" },
    { label: "Unicode / accents", value: "Ñörmäl Tëxt Àçćéñts" },
    { label: "RTL Arabic", value: "اختبار عربي" },
    { label: "Zero-width chars", value: "a​b‌c" },
  ],
  "Security probes": [
    { label: "XSS <script>", value: "<script>alert('protest')</script>" },
    { label: "XSS img onerror", value: "<img src=x onerror=alert(1)>" },
    { label: "SQL-ish", value: "' OR '1'='1' --" },
    { label: "HTML injection", value: "<b>bold</b> &amp; entity" },
    { label: "Template literal", value: "${7*7} {{7*7}}" },
    { label: "Path traversal", value: "../../etc/passwd" },
  ],
  Formats: [
    { label: "Valid email", value: "qa.tester+edge@example.com" },
    { label: "Invalid email", value: "not-an-email@@x" },
    { label: "Valid URL", value: "https://example.com/path?a=1#top" },
    { label: "Phone (intl)", value: "+44 20 7946 0958" },
    { label: "ISO date", value: "2026-02-29" },
    { label: "Ambiguous date", value: "03/04/05" },
    { label: "UUID", value: "550e8400-e29b-41d4-a716-446655440000" },
    { label: "Credit-card test #", value: "4111 1111 1111 1111" },
  ],
};

// Realistic fake identities for filling out multi-field forms quickly.
const FIRST = ["Alex", "Sam", "Jordan", "Taylor", "Morgan", "Riley", "Casey", "Noor"];
const LAST = ["Kim", "Patel", "Garcia", "Okafor", "Nguyen", "Rossi", "Haddad", "Smith"];
const DOMAINS = ["example.com", "test.dev", "mailinator.com", "qa.local"];

function pick(arr, i) {
  // Deterministic-ish rotation so repeated calls vary without Math.random reliance.
  return arr[(i + arr.length) % arr.length];
}

export function fakeIdentity(seed = Date.now()) {
  const i = Math.floor(seed / 1000);
  const first = pick(FIRST, i);
  const last = pick(LAST, i + 3);
  return {
    firstName: first,
    lastName: last,
    fullName: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@${pick(DOMAINS, i)}`,
    phone: `+1 555 ${String(100 + (i % 900)).padStart(3, "0")} ${String(1000 + (i % 9000)).padStart(4, "0")}`,
    username: `${first.toLowerCase()}_${last.toLowerCase()}${i % 99}`,
    password: `Pw!${first}${(i % 1000)}#`,
    address: `${100 + (i % 900)} Test Street`,
    city: "Springfield",
    zip: String(10000 + (i % 89999)),
  };
}

// A flat, searchable list for the side-panel quick-inject dropdown.
export function flattenTestData() {
  const out = [];
  for (const [group, items] of Object.entries(TEST_DATA)) {
    for (const item of items) out.push({ group, ...item });
  }
  return out;
}
