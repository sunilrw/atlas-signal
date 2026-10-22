/**
 * This Next.js version URI-encodes dynamic Server Component page params.
 * Decode once at that boundary, before serializing an ID into client state.
 * Route Handler params are already decoded: do not use this helper in APIs.
 */
export function decodeEventPageId(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 160 * 3) return null;
  try {
    const id = decodeURIComponent(value);
    // A remaining '%' indicates double encoding, not a second decoding pass.
    return /^[\w:-]{1,160}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
