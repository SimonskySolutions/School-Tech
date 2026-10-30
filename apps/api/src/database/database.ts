import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { type PersonId } from '@pythagoras/shared';

// The only module that talks to PostgreSQL (ADR 0013). Business code receives a
// PersonTransaction from withPerson(); row-level security then decides what it
// can see and change. System operations are named, fixed statements.

export interface RequestContext {
  readonly personId: PersonId;
  readonly requestId: string;
}

export interface SiteRow {
  website_id: string;
  code: string;
  name: string;
  purpose: string;
  cms_tenant_key: string | null;
  default_locale: string;
  schools: { name: string; kind: string }[];
}

export interface PersonTransaction {
  query<Row extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<Row[]>;
}

export interface DatabaseOptions {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string | undefined;
  readonly max: number;
}

export class Database {
  private readonly pool: Pool;

  constructor(options: DatabaseOptions) {
    this.pool = new Pool({
      ...options,
      application_name: 'pythagoras-api',
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  /** Runs work in one transaction as the given person. Commits on success, rolls back on any error. */
  async withPerson<T>(context: RequestContext, work: (tx: PersonTransaction) => Promise<T>): Promise<T> {
    return this.transaction(async (client) => {
      await client.query(
        `SELECT set_config('app.person_id', $1, true), set_config('app.request_id', $2, true),
                set_config('app.actor', 'api', true)`,
        [context.personId, context.requestId],
      );
      return work({
        query: async <Row extends QueryResultRow>(sql: string, params: readonly unknown[] = []) =>
          (await client.query<Row>(sql, params as unknown[])).rows,
      });
    });
  }

  /** System operation: maps a verified identity-provider subject to an active person, or null. */
  async resolveLogin(provider: 'keycloak', subject: string): Promise<PersonId | null> {
    const result = await this.pool.query<{ person_id: PersonId | null }>(
      'SELECT access.resolve_login($1, $2) AS person_id',
      [provider, subject],
    );
    return result.rows[0]?.person_id ?? null;
  }

  /** System operation: the live website a verified host name belongs to, or null. */
  async resolveHostname(hostname: string): Promise<{ websiteId: string; purpose: string } | null> {
    const result = await this.pool.query<{ website_id: string; website_purpose: string }>(
      'SELECT website_id, website_purpose FROM org.resolve_hostname($1)',
      [hostname],
    );
    const row = result.rows[0];
    return row ? { websiteId: row.website_id, purpose: row.website_purpose } : null;
  }

  /**
   * System operation: the live website behind a verified host name, with the
   * active schools it presents. Public information; read without a person.
   */
  async resolveWebsite(hostname: string): Promise<SiteRow | null> {
    const result = await this.pool.query<SiteRow>(
      `SELECT w.id AS website_id, w.code, w.name, w.purpose, w.cms_tenant_key, w.default_locale,
              coalesce(json_agg(json_build_object('name', s.name, 'kind', s.kind) ORDER BY ws.is_primary_website_for_school DESC, s.name)
                         FILTER (WHERE s.id IS NOT NULL), '[]') AS schools
         FROM org.resolve_hostname($1) r
         JOIN org.website w ON w.id = r.website_id
         LEFT JOIN org.website_school ws ON ws.website_id = w.id
         LEFT JOIN org.school s ON s.id = ws.school_id AND s.status = 'active'
        GROUP BY w.id`,
      [hostname],
    );
    return result.rows[0] ?? null;
  }

  /**
   * System operation: stores a provider event whose signature has been verified.
   * Duplicate deliveries hit the unique key and are reported, not stored twice.
   */
  async storeVerifiedEvent(event: {
    provider: string;
    mode: string;
    eventId: string;
    type: string;
    createdAt: Date;
    payload: unknown;
  }): Promise<'stored' | 'duplicate'> {
    const result = await this.pool.query(
      `INSERT INTO integration.inbound_event
         (provider, provider_mode, provider_event_id, event_type, provider_created_at, signature_verified, payload)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       ON CONFLICT DO NOTHING`,
      [event.provider, event.mode, event.eventId, event.type, event.createdAt, JSON.stringify(event.payload)],
    );
    return result.rowCount === 1 ? 'stored' : 'duplicate';
  }

  /** System operation: readiness check. */
  async ping(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
