export function sanitizeFilename(filename: string) {
  const trimmed = filename.trim().toLowerCase();
  const normalized = trimmed
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return normalized || "upload.bin";
}

const leetMap: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "@": "a",
  "$": "s",
  "!": "i",
  "+": "t",
};

export function normalizePrompt(input: string) {
  const lowered = input.toLowerCase().trim();
  const collapsedWhitespace = lowered.replace(/\s+/g, " ");
  const deobfuscated = [...collapsedWhitespace]
    .map((char) => leetMap[char] ?? char)
    .join("")
    .replace(/[\W_]+/g, " ");

  return deobfuscated.replace(/\s+/g, " ").trim();
}
