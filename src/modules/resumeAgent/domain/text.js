const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has",
  "have", "in", "is", "it", "of", "on", "or", "that", "the", "to", "was",
  "were", "will", "with", "you", "your", "our", "we", "this", "their",
]);

export function normalizeTerm(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[._/\\-]+/g, " ")
    .replace(/[^a-z0-9+# ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function uniqueTerms(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const display = String(value || "").trim();
    const normalized = normalizeTerm(display);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(display);
  }
  return result;
}

export function tokenize(value) {
  return normalizeTerm(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

export function tokenOverlap(left, right) {
  const leftTokens = new Set(tokenize(left));
  const rightTokens = new Set(tokenize(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let matches = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) matches += 1;
  }
  return matches / Math.max(leftTokens.size, rightTokens.size);
}

export function includesTerm(haystack, needle) {
  const normalizedNeedle = normalizeTerm(needle);
  if (!normalizedNeedle) return false;
  const normalizedHaystack = ` ${normalizeTerm(haystack)} `;
  return normalizedHaystack.includes(` ${normalizedNeedle} `);
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

