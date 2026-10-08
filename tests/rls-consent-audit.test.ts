import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Same rule as the foundations suite: skipped without TEST_ADMIN_DATABASE_URL, and a throwaway
// database is created and dropped for each run.
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const migrations = ['0001_foundations.sql', '0002_consent_audit_requests.sql'].map((f) =>
  readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'),
);

function withDatabase(url: string, dbName: string): string {
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  return u.toString();
}

const describeWithDb = adminUrl ? describe : describe.skip;

describeWithDb('row-level security: consent, data requests, audit log', () => {
  const dbName = `valaunchpad_test_${randomUUID().replace(/-/g, '')}`;
  const alice = randomUUID();
  const bob = randomUUID();
  const adminUser = randomUUID();
  let admin: Client;
  let db: Client;

  // Runs fn as an authenticated user inside a transaction that is always rolled back.
  async function asUser<T>(userId: string | null, fn: (c: Client) => Promise<T>): Promise<T> {
    await db.query('begin');
    try {
      await db.query('set local role authenticated');
      await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? '']);
      return await fn(db);
    } finally {
      await db.query('rollback');
    }
  }

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    db = new Client({ connectionString: withDatabase(adminUrl!, dbName) });
    await db.connect();
    await db.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then
          create role authenticated nologin;
        end if;
        if not exists (select 1 from pg_roles where rolname = 'anon') then
          create role anon nologin;
        end if;
      end $$`);
    await db.query('alter default privileges in schema public grant all on tables to authenticated, anon');
    for (const sql of migrations) await db.query(sql);

    await db.query(
      `insert into profiles (id, email) values ($1, 'alice@example.com'), ($2, 'bob@example.com'), ($3, 'admin@example.com')`,
      [alice, bob, adminUser],
    );
    await db.query(
      `insert into consent_versions (kind, version) values ('privacy', 'v1'), ('terms', 'v1'), ('terms', 'v2')`,
    );
    await db.query(
      `insert into consents (user_id, kind, version) values ($1, 'privacy', 'v1'), ($2, 'privacy', 'v1')`,
      [alice, bob],
    );
    await db.query(
      `insert into data_requests (user_id, kind) values ($1, 'export'), ($2, 'delete')`,
      [alice, bob],
    );
    await db.query(
      `insert into audit_log (actor_id, action, target_type, target_id) values ($1, 'seed', 'profile', $2)`,
      [adminUser, alice],
    );
  });

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
  });

  describe('consents', () => {
    it('a person sees only their own consent history', async () => {
      const res = await asUser(alice, (c) => c.query('select user_id from consents'));
      expect(res.rows.map((r) => r.user_id)).toEqual([alice]);
    });

    it('a person can record their own acceptance of a new version', async () => {
      const res = await asUser(alice, (c) =>
        c.query("insert into consents (user_id, kind, version) values ($1, 'terms', 'v2')", [alice]),
      );
      expect(res.rowCount).toBe(1);
    });

    it('a person cannot record consent for someone else', async () => {
      await expect(
        asUser(alice, (c) =>
          c.query("insert into consents (user_id, kind, version) values ($1, 'privacy', 'v1')", [bob]),
        ),
      ).rejects.toThrow(/row-level security|permission denied/);
    });

    it('a person cannot backdate the accepted_at time', async () => {
      await expect(
        asUser(alice, (c) =>
          c.query(
            "insert into consents (user_id, kind, version, accepted_at) values ($1, 'privacy', 'v1', '2020-01-01')",
            [alice],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('a person cannot accept a version that has not been published', async () => {
      await expect(
        asUser(alice, (c) =>
          c.query("insert into consents (user_id, kind, version) values ($1, 'terms', 'v999')", [alice]),
        ),
      ).rejects.toThrow(/foreign key|permission denied/);
    });

    it('people cannot publish consent versions', async () => {
      await expect(
        asUser(alice, (c) => c.query("insert into consent_versions (kind, version) values ('terms', 'v3')")),
      ).rejects.toThrow(/permission denied/);
    });

    it('consent history cannot be edited or deleted', async () => {
      await expect(
        asUser(alice, (c) => c.query('update consents set version = $1 where user_id = $2', ['x', alice])),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asUser(alice, (c) => c.query('delete from consents where user_id = $1', [alice])),
      ).rejects.toThrow(/permission denied/);
    });

    it('anonymous users see and record nothing', async () => {
      // Each statement runs in its own transaction, so one error cannot mask the next check.
      const asAnon = async (sql: string, params: unknown[] = []) => {
        await db.query('begin');
        try {
          await db.query('set local role anon');
          return await db.query(sql, params);
        } finally {
          await db.query('rollback');
        }
      };
      await expect(asAnon('select id from consents')).rejects.toThrow(/permission denied/);
      await expect(
        asAnon("insert into consents (user_id, kind, version) values ($1, 'privacy', 'v1')", [alice]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('data requests', () => {
    it('a person sees only their own requests', async () => {
      const res = await asUser(alice, (c) => c.query('select user_id, kind from data_requests'));
      expect(res.rows).toEqual([{ user_id: alice, kind: 'export' }]);
    });

    it('a person can ask for an export or a deletion', async () => {
      const res = await asUser(alice, (c) =>
        c.query("insert into data_requests (user_id, kind) values ($1, 'delete')", [alice]),
      );
      expect(res.rowCount).toBe(1);
    });

    it('a person cannot mark their own request as completed', async () => {
      await expect(
        asUser(alice, (c) =>
          c.query(
            "insert into data_requests (user_id, kind, status, completed_at) values ($1, 'export', 'completed', now())",
            [alice],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('a person cannot withdraw or delete their own request', async () => {
      await expect(
        asUser(alice, (c) => c.query('delete from data_requests where user_id = $1', [alice])),
      ).rejects.toThrow(/permission denied/);
    });

    it('a request cannot be completed before it was made', async () => {
      await expect(
        db.query(
          "insert into data_requests (user_id, kind, status, requested_at, completed_at) values ($1, 'export', 'completed', now(), now() - interval '1 day')",
          [bob],
        ),
      ).rejects.toThrow(/check constraint/);
    });

    it('a person cannot change the status of an existing request', async () => {
      await expect(
        asUser(alice, (c) => c.query("update data_requests set status = 'completed' where user_id = $1", [alice])),
      ).rejects.toThrow(/permission denied/);
    });

    it('a person cannot file a request for someone else', async () => {
      await expect(
        asUser(alice, (c) => c.query("insert into data_requests (user_id, kind) values ($1, 'export')", [bob])),
      ).rejects.toThrow(/row-level security|permission denied/);
    });
  });

  describe('audit log', () => {
    it('ordinary users cannot read the audit log at all', async () => {
      await expect(asUser(alice, (c) => c.query('select id from audit_log'))).rejects.toThrow(/permission denied/);
    });

    it('ordinary users cannot write to the audit log', async () => {
      await expect(
        asUser(alice, (c) =>
          c.query("insert into audit_log (action, target_type, target_id) values ('forge', 'profile', 'x')"),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('no role can change or remove an audit row, even the table owner', async () => {
      await expect(db.query("update audit_log set action = 'rewritten'")).rejects.toThrow(/append-only/);
      await expect(db.query('delete from audit_log')).rejects.toThrow(/append-only/);
    });

    it('the audit log cannot be emptied with TRUNCATE, even by the table owner', async () => {
      await expect(db.query('truncate audit_log')).rejects.toThrow(/append-only/);
    });

    it('erasing an admin profile succeeds and keeps the record of what they did', async () => {
      const departed = randomUUID();
      await db.query("insert into profiles (id, email) values ($1, 'departed@example.com')", [departed]);
      await db.query(
        "insert into audit_log (actor_id, action, target_type, target_id) values ($1, 'approve_refund', 'payment', 'p1')",
        [departed],
      );
      await db.query('delete from profiles where id = $1', [departed]);
      const left = await db.query('select count(*)::int as n from audit_log where actor_id = $1', [departed]);
      expect(left.rows[0].n).toBe(1);
    });

    it('the table owner can append rows, which is how the server records admin actions', async () => {
      await db.query(
        "insert into audit_log (actor_id, action, target_type, target_id) values ($1, 'grant_credit', 'enrollment', 'e1')",
        [adminUser],
      );
      const res = await db.query('select count(*)::int as n from audit_log');
      expect(res.rows[0].n).toBeGreaterThanOrEqual(2);
    });
  });
});
