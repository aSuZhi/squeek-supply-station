import { createHash, randomBytes } from "node:crypto";
export const randomHex = (n = 32) => "0x" + randomBytes(n).toString("hex");
export const sha = (value) => createHash("sha256").update(value).digest("hex");
export const dayOf = (ms = Date.now()) =>
  new Date(ms).toISOString().slice(0, 10);
export function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function fail(code, statusCode = 400) {
  return Object.assign(new Error(code), { statusCode, code });
}
export function requireValue(
  condition,
  code = "invalid_request",
  status = 400,
) {
  if (!condition) throw fail(code, status);
}
export const hex32 = (x) =>
  typeof x === "string" && /^0x[0-9a-fA-F]{64}$/.test(x);
export const integer = (x, min, max) =>
  Number.isSafeInteger(x) && x >= min && x <= max;
