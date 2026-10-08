import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The database suite runs against a throwaway database created on the server named in
// TEST_ADMIN_DATABASE_URL. Without that variable it is skipped locally, but CI=true makes
// the missing variable a failure so the security tests can never be skipped silently.
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
const migrationSql = readFileSync(
  new URL('../db/migrations/0001_foundations.sql', import.meta.url),
  'utf8',
);

function withDatabase(url: string, dbName: string): string {
  const u = new URL(url);
  u.pathname = `/${dbName}`;
  return u.toString();
}

it('has a database configured when running in CI', () => {
  if (process.env.CI === 'true') {
    expect(adminUrl, 'TEST_ADMIN_DATABASE_URL must be set in CI').toBeTruthy();
  }
});

const describeWithDb = adminUrl ? describe : describe.skip;

describeWithDb('row-level security: foundations', () => {
  const dbName = `valaunchpad_test_${randomUUID().replace(/-/g, '')}`;
  const ownerA = randomUUID();
  const learnerA = randomUUID();
  const ownerB = randomUUID();
  const newcomer = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const tokenA = 'token-for-newcomer-to-a';
  const tokenExpired = 'token-expired';

  let admin: Client;
  let db: Client;

  // Runs fn as an authenticated user inside a transaction that is always rolled back,
  // so tests cannot leak data into each other.
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
    // Supabase gives the authenticated role full table privileges by default. Reproduce that
    // before the migration, so the test proves the migration's revokes and column grants work
    // under the same conditions as production, not only on a bare Postgres.
    // Roles are cluster-wide, so create them only when a previous run has not already done so.
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
    await db.query(migrationSql);

    // Seed as the table owner, which bypasses RLS.
    await db.query(
      `insert into profiles (id, email, name) values
         ($1, 'owner-a@example.com', 'Owner A'),
         ($2, 'learner-a@example.com', 'Learner A'),
         ($3, 'owner-b@example.com', 'Owner B'),
         ($4, 'newcomer@example.com', 'Newcomer')`,
      [ownerA, learnerA, ownerB, newcomer],
    );
    await db.query(
      `insert into organizations (id, name) values ($1, 'Kumpanya A'), ($2, 'Kumpanya B')`,
      [orgA, orgB],
    );
    await db.query(
      `insert into memberships (org_id, user_id, role) values
         ($1, $2, 'owner'),
         ($1, $3, 'learner'),
         ($4, $5, 'owner')`,
      [orgA, ownerA, learnerA, orgB, ownerB],
    );
    await db.query(
      `insert into invites (org_id, email, role, token_hash, expires_at, created_by) values
         ($1, 'newcomer@example.com', 'learner', encode(sha256(convert_to($2, 'UTF8')), 'hex'),
          now() + interval '7 days', $3),
         ($1, 'newcomer@example.com', 'learner', encode(sha256(convert_to($4, 'UTF8')), 'hex'),
          now() - interval '1 day', $3),
         ($5, 'owner-b@example.com', 'learner', encode(sha256(convert_to('token-b', 'UTF8')), 'hex'),
          now() + interval '7 days', $6)`,
      [orgA, tokenA, ownerA, tokenExpired, orgB, ownerB],
    );
  });

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
  });

  describe('visibility', () => {
    it('owner of company A sees only company A', async () => {
      const res = await asUser(ownerA, (c) => c.query('select id from organizations'));
      expect(res.rows.map((r) => r.id)).toEqual([orgA]);
    });

    it('learner of company A sees company A and not company B', async () => {
      const res = await asUser(learnerA, (c) => c.query('select id from organizations'));
      expect(res.rows.map((r) => r.id)).toEqual([orgA]);
    });

    it('learner sees only their own membership, not the other members', async () => {
      const res = await asUser(learnerA, (c) =>
        c.query('select user_id from memberships where org_id = $1', [orgA]),
      );
      expect(res.rows.map((r) => r.user_id)).toEqual([learnerA]);
    });

    it('owner of company A sees all company A members and no company B members', async () => {
      const res = await asUser(ownerA, (c) => c.query('select org_id, user_id from memberships'));
      expect(res.rows).toHaveLength(2);
      expect(res.rows.every((r) => r.org_id === orgA)).toBe(true);
    });

    it('each user sees only their own profile', async () => {
      const res = await asUser(ownerA, (c) => c.query('select id from profiles'));
      expect(res.rows.map((r) => r.id)).toEqual([ownerA]);
    });

    it('owner of company A sees only company A invites', async () => {
      const res = await asUser(ownerA, (c) => c.query('select org_id from invites'));
      expect(res.rows).toHaveLength(2);
      expect(res.rows.every((r) => r.org_id === orgA)).toBe(true);
    });

    it('learners cannot see invites at all', async () => {
      const res = await asUser(learnerA, (c) => c.query('select id from invites'));
      expect(res.rowCount).toBe(0);
    });

    it('anonymous requests see no companies, members, profiles, or invites', async () => {
      const counts = await asUser(null, async (c) => {
        const tables = ['organizations', 'memberships', 'profiles', 'invites'];
        const out: Record<string, number> = {};
        for (const t of tables) {
          out[t] = (await c.query(`select count(*)::int as n from ${t}`)).rows[0].n;
        }
        return out;
      });
      expect(counts).toEqual({ organizations: 0, memberships: 0, profiles: 0, invites: 0 });
    });
  });

  describe('writes by learners', () => {
    it('learner cannot insert a membership, so cannot make themselves an owner', async () => {
      await expect(
        asUser(learnerA, (c) =>
          c.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')", [
            orgA,
            learnerA,
          ]),
        ),
      ).rejects.toThrow(/permission denied|row-level security/);
    });

    it('learner cannot promote themselves with an update', async () => {
      const updated = await asUser(learnerA, (c) =>
        c.query("update memberships set role = 'owner' where org_id = $1 and user_id = $2", [
          orgA,
          learnerA,
        ]),
      );
      expect(updated.rowCount).toBe(0);
      const role = await db.query('select role from memberships where org_id=$1 and user_id=$2', [
        orgA,
        learnerA,
      ]);
      expect(role.rows[0].role).toBe('learner');
    });

    it('learner cannot remove a membership, including their own', async () => {
      const deleted = await asUser(learnerA, (c) =>
        c.query('delete from memberships where org_id = $1', [orgA]),
      );
      expect(deleted.rowCount).toBe(0);
    });

    it('learner cannot rename the company', async () => {
      const updated = await asUser(learnerA, (c) =>
        c.query("update organizations set name = 'Hacked' where id = $1", [orgA]),
      );
      expect(updated.rowCount).toBe(0);
      const name = await db.query('select name from organizations where id = $1', [orgA]);
      expect(name.rows[0].name).toBe('Kumpanya A');
    });

    it('learner cannot change their own email', async () => {
      await expect(
        asUser(learnerA, (c) =>
          c.query("update profiles set email = 'someone-else@example.com' where id = $1", [
            learnerA,
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('learner can update their own name', async () => {
      const updated = await asUser(learnerA, (c) =>
        c.query("update profiles set name = 'Learner A (bago)' where id = $1", [learnerA]),
      );
      expect(updated.rowCount).toBe(1);
    });
  });

  describe('writes by owners', () => {
    it('owner of company A can promote a learner in company A', async () => {
      const updated = await asUser(ownerA, (c) =>
        c.query("update memberships set role = 'owner' where org_id = $1 and user_id = $2", [
          orgA,
          learnerA,
        ]),
      );
      expect(updated.rowCount).toBe(1);
    });

    it('owner of company A cannot change company B memberships', async () => {
      const updated = await asUser(ownerA, (c) =>
        c.query("update memberships set role = 'learner' where org_id = $1", [orgB]),
      );
      expect(updated.rowCount).toBe(0);
    });

    it('owner cannot insert a membership directly, so people join only through invites', async () => {
      await expect(
        asUser(ownerA, (c) =>
          c.query("insert into memberships (org_id, user_id, role) values ($1, $2, 'learner')", [
            orgA,
            newcomer,
          ]),
        ),
      ).rejects.toThrow(/permission denied|row-level security/);
    });

    it('owner can invite into their own company but not into company B', async () => {
      const own = await asUser(ownerA, (c) =>
        c.query(
          `insert into invites (org_id, email, role, token_hash, expires_at, created_by)
           values ($1, 'other@example.com', 'learner', 'hash-own', now() + interval '7 days', $2)`,
          [orgA, ownerA],
        ),
      );
      expect(own.rowCount).toBe(1);

      await expect(
        asUser(ownerA, (c) =>
          c.query(
            `insert into invites (org_id, email, role, token_hash, expires_at, created_by)
             values ($1, 'other@example.com', 'learner', 'hash-b', now() + interval '7 days', $2)`,
            [orgB, ownerA],
          ),
        ),
      ).rejects.toThrow(/permission denied|row-level security/);
    });

    it('the last owner of a company cannot demote or remove themselves', async () => {
      await expect(
        asUser(ownerB, (c) =>
          c.query("update memberships set role = 'learner' where org_id = $1 and user_id = $2", [
            orgB,
            ownerB,
          ]),
        ),
      ).rejects.toThrow(/at least one owner/);
      await expect(
        asUser(ownerB, (c) =>
          c.query('delete from memberships where org_id = $1 and user_id = $2', [orgB, ownerB]),
        ),
      ).rejects.toThrow(/at least one owner/);
    });
  });

  describe('membership integrity', () => {
    it('an owner cannot move a membership to a different person, which would bypass invites', async () => {
      await expect(
        asUser(ownerA, (c) =>
          c.query('update memberships set user_id = $1 where org_id = $2 and user_id = $3', [
            newcomer,
            orgA,
            learnerA,
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('an owner cannot move a membership to a different company', async () => {
      await expect(
        asUser(ownerA, (c) =>
          c.query('update memberships set org_id = $1 where org_id = $2 and user_id = $3', [
            orgB,
            orgA,
            learnerA,
          ]),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('anonymous role has no privileges on any table', async () => {
      await db.query('begin');
      try {
        await db.query('set local role anon');
        await expect(db.query('select id from organizations')).rejects.toThrow(/permission denied/);
      } finally {
        await db.query('rollback');
      }
    });
  });

  describe('invites from owners who have left', () => {
    it('an invite stops working once the owner who created it is removed', async () => {
      await db.query('begin');
      try {
        await db.query('set local role authenticated');
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerA]);
        // Make the learner an owner first, so the company keeps one after ownerA leaves.
        await db.query("update memberships set role = 'owner' where org_id = $1 and user_id = $2", [
          orgA,
          learnerA,
        ]);
        const invite = await db.query(
          `insert into invites (org_id, email, role, token_hash, expires_at, created_by)
           values ($1, 'newcomer@example.com', 'owner', encode(sha256(convert_to('token-orphan', 'UTF8')), 'hex'),
                   now() + interval '7 days', $2) returning id`,
          [orgA, ownerA],
        );
        expect(invite.rowCount).toBe(1);
        await db.query('delete from memberships where org_id = $1 and user_id = $2', [orgA, ownerA]);
        await db.query("select set_config('request.jwt.claim.sub', $1, true)", [newcomer]);
        await expect(db.query('select accept_invite($1)', ['token-orphan'])).rejects.toThrow(
          /not found, expired, or already used/,
        );
      } finally {
        await db.query('rollback');
      }
    });
  });

  describe('column and table privileges', () => {
    it('owners cannot rewrite the company creation date', async () => {
      await expect(
        asUser(ownerA, (c) => c.query("update organizations set created_at = now() - interval '1 year' where id = $1", [orgA])),
      ).rejects.toThrow(/permission denied/);
    });

    it('owners can rename their own company', async () => {
      const res = await asUser(ownerA, (c) =>
        c.query("update organizations set name = 'Kumpanya A Renamed' where id = $1", [orgA]),
      );
      expect(res.rowCount).toBe(1);
    });

    it('owners cannot revive an accepted invite by clearing accepted_at', async () => {
      await expect(
        asUser(ownerA, (c) => c.query('update invites set accepted_at = null where org_id = $1', [orgA])),
      ).rejects.toThrow(/permission denied/);
    });

    it('anon cannot execute the membership functions', async () => {
      await db.query('begin');
      try {
        await db.query('set local role anon');
        await expect(db.query('select accept_invite($1)', [tokenA])).rejects.toThrow(/permission denied/);
      } finally {
        await db.query('rollback');
      }
    });
  });

  describe('invites', () => {
    it('a newcomer with the matching email can accept a valid invite', async () => {
      const joined = await asUser(newcomer, async (c) => {
        const res = await c.query('select accept_invite($1) as org_id', [tokenA]);
        const membership = await c.query('select role from memberships where org_id = $1', [
          res.rows[0].org_id,
        ]);
        return { org: res.rows[0].org_id, membership: membership.rows };
      });
      expect(joined.org).toBe(orgA);
      expect(joined.membership).toEqual([{ role: 'learner' }]);
    });

    it('an invite cannot be accepted by someone with a different email', async () => {
      await expect(
        asUser(learnerA, (c) => c.query('select accept_invite($1)', [tokenA])),
      ).rejects.toThrow(/different email/);
    });

    it('an expired invite is refused', async () => {
      await expect(
        asUser(newcomer, (c) => c.query('select accept_invite($1)', [tokenExpired])),
      ).rejects.toThrow(/not found, expired, or already used/);
    });

    it('an invite cannot be accepted twice', async () => {
      await expect(
        asUser(newcomer, async (c) => {
          await c.query('select accept_invite($1)', [tokenA]);
          await c.query('select accept_invite($1)', [tokenA]);
        }),
      ).rejects.toThrow(/not found, expired, or already used/);
    });

    it('anonymous users cannot accept invites', async () => {
      await expect(
        asUser(null, (c) => c.query('select accept_invite($1)', [tokenA])),
      ).rejects.toThrow(/not authenticated/);
    });
  });

  describe('concurrency', () => {
    it('two owners cannot demote each other at the same time, leaving the company with no owner', async () => {
      // Two real connections, with a fixed interleaving so the result never depends on timing:
      //   1. Session 1 demotes owner x inside an open transaction (it locks the owner rows).
      //   2. Session 2 demotes owner y. Its trigger waits on session 1's lock.
      //   3. Session 1 commits. Session 2 wakes up, now sees only y as an owner, and must refuse.
      const second = new Client({ connectionString: withDatabase(adminUrl!, dbName) });
      await second.connect();
      const orgC = randomUUID();
      const x = randomUUID();
      const y = randomUUID();
      let firstOpen = false;
      let secondOpen = false;
      try {
        await db.query(
          `insert into profiles (id, email) values ($1, 'x@example.com'), ($2, 'y@example.com')`,
          [x, y],
        );
        await db.query(`insert into organizations (id, name) values ($1, 'Kumpanya Race')`, [orgC]);
        await db.query(
          `insert into memberships (org_id, user_id, role) values ($1, $2, 'owner'), ($1, $3, 'owner')`,
          [orgC, x, y],
        );

        await db.query('begin');
        firstOpen = true;
        await db.query("update memberships set role = 'learner' where org_id = $1 and user_id = $2", [
          orgC,
          x,
        ]);

        await second.query('begin');
        secondOpen = true;
        const other = second
          .query("update memberships set role = 'learner' where org_id = $1 and user_id = $2", [
            orgC,
            y,
          ])
          .then(
            () => null,
            (err: Error) => err,
          );

        // Wait until session 2 is actually blocked on session 1's lock before committing.
        const deadline = Date.now() + 10_000;
        for (;;) {
          const waiting = await db.query(
            "select count(*)::int as n from pg_stat_activity where datname = $1 and wait_event_type = 'Lock'",
            [dbName],
          );
          if (waiting.rows[0].n >= 1) break;
          if (Date.now() > deadline) throw new Error('session 2 never waited on the lock');
          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        await db.query('commit');
        firstOpen = false;

        const err = await other;
        expect(err, 'the second demotion must be refused').toBeInstanceOf(Error);
        expect((err as Error).message).toMatch(/at least one owner/);

        await second.query('rollback');
        secondOpen = false;

        const owners = await db.query(
          "select count(*)::int as n from memberships where org_id = $1 and role = 'owner'",
          [orgC],
        );
        expect(owners.rows[0].n).toBe(1);
      } finally {
        if (firstOpen) await db.query('rollback').catch(() => {});
        if (secondOpen) await second.query('rollback').catch(() => {});
        await second.end();
      }
    });
  });

  describe('company creation', () => {
    it('create_organization makes the caller its only owner, and other companies cannot see it', async () => {
      const newOrg = await asUser(ownerB, async (c) => {
        const created = await c.query('select create_organization($1) as id', ['Kumpanya C']);
        const id: string = created.rows[0].id;
        const role = await c.query('select role from memberships where org_id = $1', [id]);
        expect(role.rows).toEqual([{ role: 'owner' }]);
        return id;
      });

      // Same transaction is required: the company only exists until the test rolls back.
      const seenByOtherOwner = await asUser(ownerB, async (c) => {
        const created = await c.query('select create_organization($1) as id', ['Kumpanya D']);
        await c.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerA]);
        const seen = await c.query('select id from organizations where id = $1', [created.rows[0].id]);
        return seen.rowCount;
      });
      expect(seenByOtherOwner).toBe(0);
      expect(newOrg).toBeTruthy();
    });

    it('create_organization refuses anonymous callers', async () => {
      await expect(
        asUser(null, (c) => c.query('select create_organization($1)', ['Nope'])),
      ).rejects.toThrow(/not authenticated/);
    });
  });
});
