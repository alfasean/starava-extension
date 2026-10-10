/** Chrome match pattern for a base URL's host. Match patterns cannot carry a port, so it is dropped. */
export function originPattern(baseUrl: string): string {
  const u = new URL(baseUrl);
  return `${u.protocol}//${u.hostname}/*`;
}

/**
 * Asks for host permission for an OpenAI-compatible base URL. Call it straight from a
 * click handler (before other awaits) so Chrome still sees the user gesture.
 * Resolves `true` when granted (or already held), `false` when denied or impossible.
 */
export async function ensureHostPermission(baseUrl: string): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: [originPattern(baseUrl)] });
  } catch {
    return false;
  }
}
