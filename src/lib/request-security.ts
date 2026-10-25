/**
 * CSRF boundary for JSON mutations. Next's internal request URL can be
 * normalized differently from the browser's loopback hostname in development,
 * so compare the browser Origin to the request Host instead of request.url.
 */
export function hasSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;

  try {
    const url = new URL(origin);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
