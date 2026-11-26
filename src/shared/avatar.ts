/** Profile pictures: what is accepted, shared by the page (early feedback) and the server (authoritative). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
/** Only these image types. (SVG is left out on purpose: it can carry script.) */
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];
export const AVATAR_ACCEPT = AVATAR_TYPES.join(",");
export const AVATAR_EXTENSION: Record<AvatarType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };

/** The bytes of a file, read for what it really is (a browser's claim is not trusted). Null when it is not one of the accepted images. */
export function sniffImage(bytes: Uint8Array): AvatarType | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 && b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a) return "image/png";
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38 && (b(4) === 0x37 || b(4) === 0x39) && b(5) === 0x61) return "image/gif";
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return "image/webp";
  return null;
}

/** A reason a chosen file cannot be used, in words for the person, or null. (Type here is the browser's claim: only an early check.) */
export function avatarProblem(file: { type: string; size: number }): string | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) return "Choose an image file (JPG, PNG, WebP or GIF)";
  if (file.size > AVATAR_MAX_BYTES) return `The picture must be at most ${AVATAR_MAX_BYTES / 1024 / 1024} MB`;
  if (file.size === 0) return "That file is empty";
  return null;
}
