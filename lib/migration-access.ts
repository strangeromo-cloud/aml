// Only a digest of the shared credential is configured on the server.
export async function validBasicCredential(header: string | null, expectedHash: string) {
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
  const match = header?.match(/^Basic ([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) return false;
  let decoded: string;
  try {
    decoded = atob(match[1]);
  } catch {
    return false;
  }
  if (!decoded.includes(":")) return false;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(decoded)));
  let difference = 0;
  for (let i = 0; i < digest.length; i++) {
    difference |= digest[i] ^ parseInt(expectedHash.slice(i * 2, i * 2 + 2), 16);
  }
  return difference === 0;
}

export function isSameOriginWrite(method: string, origin: string | null, host: string | null) {
  if (["GET", "HEAD", "OPTIONS"].includes(method) || !origin) return true;
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) && url.host === host;
  } catch {
    return false;
  }
}
