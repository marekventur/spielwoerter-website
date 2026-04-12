import type express from "express";

/**
 * Validates the X-API-Key header against APPROVED_THIRD_PARTY_API_KEYS env var
 * (comma-separated list). Returns a short label for the key (used for audit),
 * or null if the key is missing/invalid (and sends a 401 response).
 */
export function requirePartnerKey(
  req: express.Request,
  res: express.Response
): string | null {
  const raw = process.env.APPROVED_THIRD_PARTY_API_KEYS ?? "";
  const keys = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const header = req.headers["x-api-key"] as string | undefined;

  if (!header || !keys.includes(header)) {
    console.warn("[partner-auth] rejected key", { ip: req.ip, path: req.path });
    res.status(401).json({ error: "Invalid API key" });
    return null;
  }

  // Label = everything before the first underscore, or first 8 chars (for audit storage)
  const label = header.includes("_") ? header.split("_")[0] : header.slice(0, 8);
  return label;
}
