// A minimal scripted browser for end-to-end tests inside the Compose network:
// keeps cookies, follows redirects by hand, and maps the public development
// addresses (localhost ports) to the service names they correspond to.

const HOST_MAP: Record<string, string> = {
  'portal.pythagoras.localhost:53000': 'web:3000',
  'localhost:58080': 'keycloak:8080',
};

export const APP = 'http://portal.pythagoras.localhost:53000';

export interface CookieRecord {
  value: string;
  attributes: string;
}

export class Browser {
  readonly cookies = new Map<string, CookieRecord>();
  lastSetCookies: string[] = [];

  async request(url: string, init: RequestInit = {}): Promise<Response> {
    const target = new URL(url);
    const mapped = HOST_MAP[target.host];
    if (mapped) target.host = mapped;
    const headers = new Headers(init.headers);
    if (this.cookies.size > 0) {
      headers.set('cookie', [...this.cookies].map(([name, cookie]) => `${name}=${cookie.value}`).join('; '));
    }
    const response = await fetch(target, { ...init, headers, redirect: 'manual' });
    this.lastSetCookies = response.headers.getSetCookie();
    for (const header of this.lastSetCookies) {
      const [pair = '', ...rest] = header.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      const attributes = rest.join(';');
      if (value === '' || /max-age=0\b/i.test(attributes)) this.cookies.delete(name);
      else this.cookies.set(name, { value, attributes });
    }
    return response;
  }

  /** Follows redirects until a non-redirect response; returns it and the last URL. */
  async follow(
    url: string,
    init: RequestInit = {},
  ): Promise<{ response: Response; url: string; trail: string[] }> {
    let current = url;
    let response = await this.request(current, init);
    const trail = [current];
    for (let hops = 0; hops < 10 && response.status >= 300 && response.status < 400; hops += 1) {
      current = new URL(response.headers.get('location')!, current).toString();
      trail.push(current);
      response = await this.request(current);
    }
    return { response, url: current, trail };
  }

  setCookie(name: string, value: string): void {
    this.cookies.set(name, { value, attributes: '' });
  }
}

/** Signs in through the real Keycloak login form. */
export async function signIn(username: string, password: string, returnTo?: string) {
  const browser = new Browser();
  const start = `${APP}/auth/sign-in${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
  const loginPage = await browser.follow(start);
  const html = await loginPage.response.text();
  const action = /id="kc-form-login"[^>]*\saction="([^"]+)"/.exec(html)?.[1]?.replaceAll('&amp;', '&');
  if (!action)
    throw new Error(`no Keycloak login form at ${loginPage.url} (status ${loginPage.response.status})`);
  const result = await browser.follow(action, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, credentialId: '' }),
  });
  return { browser, ...result, html: await result.response.text() };
}
