import { ATTACHMENT_TYPES, MAX_ATTACHMENTS, MAX_ATTACHMENT_NAME, MAX_TOTAL_ATTACHMENT_BYTES, attachmentProblem, extensionOf, isAllowedExtension, type AttachmentExtension } from "../../shared/email-attachments";
import { ApiError } from "./errors";

/** One file to attach, already checked. `contentType` comes from our own table, never from what the browser claimed. */
export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

/** What a real file of each kind starts with. A file renamed to .pdf is not one. */
const MAGIC: Record<AttachmentExtension, number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  doc: [[0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]], // an OLE2 compound file, which is what .doc is
  docx: [[0x50, 0x4b, 0x03, 0x04]], // a ZIP archive, which is what .docx is
};

/** Base64 of raw bytes, in slices: spreading a whole file into `fromCharCode` would overflow the call stack. */
export function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((b, i) => bytes[i] === b);

/**
 * A safe file name for a header: only the last path part, no control characters, quotes, slashes or semicolons, not too long, and
 * the extension kept (a message with `evil.pdf"; x=` cannot grow extra header parameters).
 */
export function safeFilename(name: string, ext: string): string {
  // eslint-disable-next-line no-control-regex
  const base = name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f"';<>:*?|]+/g, " ").replace(/\s+/g, " ").trim();
  const stem = base.replace(/\.[^.]*$/, "").replace(/^\.+/, "").trim() || "attachment";
  const room = MAX_ATTACHMENT_NAME - ext.length - 1;
  return `${stem.slice(0, Math.max(1, room)).trim()}.${ext}`;
}

/**
 * Reads the files of a submitted form: refuses anything that is not a PDF or Word document (by extension AND by the file's first
 * bytes), too many files, too much in all, or an empty one. Throws an ApiError the person can act on. Reads each file once.
 */
export async function readAttachments(files: File[]): Promise<EmailAttachment[]> {
  if (files.length > MAX_ATTACHMENTS) throw new ApiError(400, "ATTACHMENT_REJECTED", `You can attach at most ${MAX_ATTACHMENTS} files`);
  const out: EmailAttachment[] = [];
  const chosen: { name: string; size: number }[] = [];
  for (const file of files) {
    const problem = attachmentProblem({ name: file.name, size: file.size }, chosen);
    if (problem) throw new ApiError(problem.includes("at most") && problem.includes("in all") ? 413 : 400, "ATTACHMENT_REJECTED", problem);
    const ext = extensionOf(file.name);
    if (!isAllowedExtension(ext)) throw new ApiError(400, "ATTACHMENT_REJECTED", `"${file.name}" is not a PDF or Word document`); // unreachable: attachmentProblem said so; keeps the type honest
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > MAX_TOTAL_ATTACHMENT_BYTES) throw new ApiError(413, "ATTACHMENT_REJECTED", "The attachments are too large");
    if (!MAGIC[ext].some((m) => startsWith(bytes, m))) throw new ApiError(400, "ATTACHMENT_REJECTED", `"${file.name}" does not look like a real .${ext} file`);
    chosen.push({ name: file.name, size: bytes.length });
    out.push({ filename: safeFilename(file.name, ext), contentType: ATTACHMENT_TYPES[ext], content: bytes });
  }
  return out;
}
