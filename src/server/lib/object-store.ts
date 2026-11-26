import { ApiError } from "./errors";

/**
 * Where uploaded files live. In the Worker this is Cloudflare R2 (the `PROFILE_PICTURES` bucket); tests and scripts pass an in-memory
 * store. Only what the app needs: keep bytes under a key, read them back, remove them.
 */
export interface StoredObject {
  body: ReadableStream | ArrayBuffer | Uint8Array;
  contentType: string;
  size: number;
}

export interface ObjectStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

/** An R2 bucket as an ObjectStore. */
export function r2Store(bucket: R2Bucket): ObjectStore {
  return {
    async put(key, bytes, contentType) {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
    },
    async get(key) {
      const o = await bucket.get(key);
      return o ? { body: o.body, contentType: o.httpMetadata?.contentType ?? "application/octet-stream", size: o.size } : null;
    },
    async delete(key) {
      await bucket.delete(key);
    },
  };
}

/** Everything in memory: for tests, and the way to try the app with no bucket. Gone when the process ends. */
export function memoryStore(): ObjectStore & { keys(): string[] } {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    async put(key, bytes, contentType) { files.set(key, { bytes: new Uint8Array(bytes), contentType }); },
    async get(key) {
      const f = files.get(key);
      return f ? { body: f.bytes, contentType: f.contentType, size: f.bytes.length } : null;
    },
    async delete(key) { files.delete(key); },
    keys: () => [...files.keys()],
  };
}

/** The store for this request: the bound R2 bucket, else a 503 that says what is missing. */
export function objectStoreFor(env: Env, injected?: ObjectStore): ObjectStore {
  if (injected) return injected;
  if (env.PROFILE_PICTURES) return r2Store(env.PROFILE_PICTURES);
  throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "File storage is not set up on this server yet");
}
