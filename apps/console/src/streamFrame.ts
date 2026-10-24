// VERIFY: TINYFISH_FACTS does not list iframe sandbox flags. allow-scripts is the minimum for the viewer script.
// VERIFY: allow-same-origin lets the stream origin keep its own session. It is safe only while that origin is not the console origin.
export const STREAM_SANDBOX = "allow-scripts allow-same-origin";

// VERIFY: fullscreen is the only Permissions-Policy token assumed for the live view. TINYFISH_FACTS does not list allow tokens.
export const STREAM_ALLOW = "fullscreen";

export const STREAM_LOAD_TIMEOUT_MS = 6000;

export function allowedStreamUrl(raw: string | null, origins: readonly string[]): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (!origins.includes(url.origin)) return null;
  return url.href;
}
