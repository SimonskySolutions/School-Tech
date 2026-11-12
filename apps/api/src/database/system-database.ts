import { Pool, type QueryResultRow } from 'pg';
import { type DatabaseOptions } from './database';

// Database access for the background worker only (ADR 0004, 0013). It connects
// as pyth_worker, acts as the system rather than a person, and records which
// job made each change in app.actor (visible in the audit log). The API never
// constructs this class; an architecture test enforces that.

export interface SystemTransaction {
  query<Row extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<Row[]>;
}

const ACTOR = /^worker:[a-z0-9-]{1,48}$/;

export class SystemDatabase {
  private readonly pool: Pool;

  constructor(options: DatabaseOptions) {
    this.pool = new Pool({
      ...options,
      application_name: 'pythagoras-worker',
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  /** Runs work in one transaction as the named job. Commits on success, rolls back on any error. */
  async withSystem<T>(actor: string, work: (tx: SystemTransaction) => Promise<T>): Promise<T> {
    if (!ACTOR.test(actor)) throw new Error(`invalid worker actor name: ${actor}`);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.actor', $1, true), set_config('app.person_id', '', true)`, [
        actor,
      ]);
      const result = await work({
        query: async <Row extends QueryResultRow>(sql: string, params: readonly unknown[] = []) =>
          (await client.query<Row>(sql, params as unknown[])).rows,
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
