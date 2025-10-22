// src/lib/phone.js
export function toE164NG(input = "") {
  const digits = String(input).replace(/\D/g, "");

  if (!digits) return "";

  // Already +234... (user typed with +)
  if (/^\+234/.test(input)) return input;

  // 234XXXXXXXXXX  -> +234XXXXXXXXXX
  if (digits.startsWith("234") && digits.length === 13) return `+${digits}`;

  // 0XXXXXXXXXX (11 digits) -> +234XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith("0")) {
    return `+234${digits.slice(1)}`;
  }

  // Fallback: if user already typed a full international with +, keep it
  if (input.trim().startsWith("+")) return input.trim();

  // Otherwise just return raw digits with a leading + if it looks like intl
  return digits.length > 11 ? `+${digits}` : input.trim();
}
