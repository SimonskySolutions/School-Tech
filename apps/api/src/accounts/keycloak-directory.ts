import { randomBytes } from 'node:crypto';

// Sign-in accounts in Keycloak for people an administrator registers (M3.2,
// ADR 0016). The API calls Keycloak's admin API as the pythagoras-provisioning
// service account, which may create, find and update users and nothing else.
// The person record stays the source of truth; Keycloak only holds the login.

export type AccountSetup = 'temporary_password' | 'email';

export interface NewAccount {
  email: string;
  givenName: string;
  familyName: string;
}

export interface CreatedAccount {
  subject: string;
  /** Development only: shown once to the administrator, must be changed at first sign-in. */
  temporaryPassword: string | null;
}

export class AccountExists extends Error {}

export interface AccountDirectory {
  createAccount(account: NewAccount): Promise<CreatedAccount>;
  /** Undoes createAccount when the link to the person cannot be stored. */
  deleteAccount(subject: string): Promise<void>;
}

export const ACCOUNT_DIRECTORY = Symbol('ACCOUNT_DIRECTORY');

/** 24 random characters from a set that is easy to read aloud: above the realm's 12-character minimum. */
export function temporaryPassword(bytes: (size: number) => Buffer = randomBytes): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return [...bytes(24)].map((byte) => alphabet[byte % alphabet.length]).join('');
}

/** The Keycloak user for a new person. Pure, so what Keycloak receives is unit-tested. */
export function keycloakUser(account: NewAccount, setup: AccountSetup) {
  return {
    username: account.email.toLowerCase(),
    email: account.email.toLowerCase(),
    firstName: account.givenName,
    lastName: account.familyName,
    enabled: true,
    // The person chooses their own password at first sign-in. With e-mail
    // setup they also prove the address is theirs. The realm requires a
    // verified address to sign in, so with a temporary password (development
    // only, no e-mail) the administrator who hands it over vouches for it.
    emailVerified: setup === 'temporary_password',
    requiredActions: setup === 'email' ? ['UPDATE_PASSWORD', 'VERIFY_EMAIL'] : ['UPDATE_PASSWORD'],
  };
}

export interface KeycloakDirectoryOptions {
  baseUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string;
  setup: AccountSetup;
  fetch?: typeof fetch;
}

export class KeycloakDirectory implements AccountDirectory {
  private token: { value: string; expiresAt: number } | undefined;
  private readonly fetch: typeof fetch;

  constructor(private readonly options: KeycloakDirectoryOptions) {
    this.fetch = options.fetch ?? fetch;
  }

  private get admin(): string {
    return `${this.options.baseUrl}/admin/realms/${this.options.realm}`;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 10_000) return this.token.value;
    const response = await this.fetch(
      `${this.options.baseUrl}/realms/${this.options.realm}/protocol/openid-connect/token`,
      {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
        }),
      },
    );
    if (!response.ok) throw new Error(`Keycloak refused the provisioning client (${response.status})`);
    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return this.token.value;
  }

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    return this.fetch(`${this.admin}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
  }

  async createAccount(account: NewAccount): Promise<CreatedAccount> {
    const created = await this.call('/users', {
      method: 'POST',
      body: JSON.stringify(keycloakUser(account, this.options.setup)),
    });
    if (created.status === 409) throw new AccountExists('a sign-in account with this e-mail already exists');
    if (created.status !== 201) throw new Error(`Keycloak refused the new user (${created.status})`);
    const subject = created.headers.get('location')?.split('/').pop();
    if (!subject) throw new Error('Keycloak did not say which user it created');

    try {
      if (this.options.setup === 'temporary_password') {
        const password = temporaryPassword();
        const reset = await this.call(`/users/${subject}/reset-password`, {
          method: 'PUT',
          body: JSON.stringify({ type: 'password', value: password, temporary: true }),
        });
        if (!reset.ok) throw new Error(`Keycloak refused the temporary password (${reset.status})`);
        return { subject, temporaryPassword: password };
      }
      // Keycloak e-mails a link to set the password and verify the address (needs SMTP, M7).
      const mail = await this.call(`/users/${subject}/execute-actions-email?lifespan=259200`, {
        method: 'PUT',
        body: JSON.stringify(['UPDATE_PASSWORD', 'VERIFY_EMAIL']),
      });
      if (!mail.ok) throw new Error(`Keycloak could not send the set-up e-mail (${mail.status})`);
      return { subject, temporaryPassword: null };
    } catch (error) {
      await this.deleteAccount(subject).catch(() => undefined);
      throw error;
    }
  }

  async deleteAccount(subject: string): Promise<void> {
    const response = await this.call(`/users/${encodeURIComponent(subject)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Keycloak refused to remove user ${subject} (${response.status})`);
    }
  }
}
