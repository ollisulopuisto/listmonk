// isSafeLinkUrl reports whether a user-supplied link URL is safe to insert
// into the editor as an anchor. Only http(s) and mailto links, protocol-
// relative URLs, relative URLs and in-page anchors are allowed; executable
// schemes (javascript:, data:, vbscript:, ...) are rejected so the URL can
// never become an XSS vector in the editor or in mails built from it.
export function isSafeLinkUrl(url) {
  const u = String(url || '').trim();
  if (!u) {
    return false;
  }
  let parsed;
  try {
    // A fixed base keeps this pure; it only decides the protocol of relative
    // URLs, which then falls into the allowed http(s) set.
    parsed = new URL(u, 'https://listmonk.invalid/');
  } catch {
    return false;
  }
  return /^(https?|mailto):$/i.test(parsed.protocol);
}
