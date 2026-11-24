/**
 * Attachments on a personally written email (the Apply panel on the Jobs page): which files are accepted, and how many and how big.
 * Shared so the page can refuse a file at once and the server (which always checks again, including the file's real contents)
 * agrees with it to the byte.
 */

/** The only kinds of file that can be attached: PDF and Word documents. */
export const ATTACHMENT_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;
export type AttachmentExtension = keyof typeof ATTACHMENT_TYPES;

/** For the file picker's `accept`: extensions and MIME types. */
export const ATTACHMENT_ACCEPT = [...Object.keys(ATTACHMENT_TYPES).map((e) => `.${e}`), ...Object.values(ATTACHMENT_TYPES)].join(",");

export const MAX_ATTACHMENTS = 3;
/** All attachments together. Gmail takes up to 25 MB per message, but base64 adds a third and the whole message is sent as one request. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENT_NAME = 100;
/**
 * The most a request carrying an email may weigh. Twice the attachment limit plus room for the words: a form a little over the
 * limit still gets the friendly "at most 5 MB in all" answer, and one far over it is stopped before it is read.
 */
export const MAX_APPLY_FORM_BYTES = 2 * MAX_TOTAL_ATTACHMENT_BYTES + 1024 * 1024;

/** The lower-case extension after the last dot, or "". */
export const extensionOf = (filename: string): string => {
  const i = filename.lastIndexOf(".");
  return i < 0 ? "" : filename.slice(i + 1).toLowerCase();
};

export const isAllowedExtension = (ext: string): ext is AttachmentExtension => Object.prototype.hasOwnProperty.call(ATTACHMENT_TYPES, ext);

export const formatBytes = (n: number): string => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Why a file cannot be added to the ones already chosen, in words for the person, or null when it can. Checks the name's
 * extension, that it is not empty, the number of files and the total size.
 */
export function attachmentProblem(file: { name: string; size: number }, chosen: readonly { name: string; size: number }[]): string | null {
  if (!isAllowedExtension(extensionOf(file.name))) return `"${file.name}" is not a PDF or Word document. Only .pdf, .doc and .docx files can be attached`;
  if (file.size === 0) return `"${file.name}" is empty`;
  if (chosen.length >= MAX_ATTACHMENTS) return `You can attach at most ${MAX_ATTACHMENTS} files`;
  if (chosen.some((c) => c.name === file.name && c.size === file.size)) return `"${file.name}" is already attached`;
  const total = chosen.reduce((n, c) => n + c.size, 0) + file.size;
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) return `The attachments can be at most ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)} in all`;
  return null;
}
