/**
 * Content-Security-Policy of the app pages: the page may talk only to itself and to the backend API. Nothing it
 * renders (model output, job adverts, page titles) can make the browser load an outside address.
 * `dev` adds what `next dev` needs (eval for fast refresh).
 */
export function contentSecurityPolicy(apiUrl: string, dev: boolean): string {
  const api = new URL(apiUrl).origin;
  const directives: [string, string][] = [
    ["default-src", "'self'"],
    ["script-src", `'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`],
    ["style-src", "'self' 'unsafe-inline'"],
    ["img-src", "'self' data: blob:"],
    ["font-src", "'self' data:"],
    ["connect-src", `'self' ${api}`],
    ["worker-src", "'self' blob:"],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'none'"],
    ["frame-ancestors", "'none'"],
  ];
  return directives.map(([name, value]) => `${name} ${value}`).join("; ");
}
