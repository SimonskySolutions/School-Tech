import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { type PersonId } from '@pythagoras/shared';

// The only module that talks to PostgreSQL (ADR 0013). Business code receives a
// PersonTransaction from withPerson(); row-level security then decides what it
// can see and change. System operations are named, fixed statements.

export interface RequestContext {
  readonly personId: PersonId;
  readonly requestId: string;
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
