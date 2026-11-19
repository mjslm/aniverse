import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const user = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const order = "33333333-3333-4333-8333-333333333333";
const renewal = "44444444-4444-4444-8444-444444444444";

test("one-click Demo VIP persists once, renews after expiry, and stays private", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
      grant usage on schema auth to authenticated;
      insert into auth.users values ('${user}'),('${other}');`);
    await db.exec(await readFile(new URL("../supabase/migrations/20261119_vip_demo.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/20261119_vip_plan_selection.sql", import.meta.url), "utf8"));
    const subscribe = async (plan = "Premium") => (await db.query("select public.subscribe_vip($1) as expiry", [plan])).rows[0].expiry;
    await db.exec("set role anon");
    await assert.rejects(subscribe(), { code: "42501" });
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await db.exec(`set request.jwt.claims = '{"is_anonymous":true}'`);
    await assert.rejects(subscribe(), { code: "42501" });
    await db.exec("reset request.jwt.claims");
    const expiry = await subscribe();
    assert.equal((await subscribe("Basic")).toISOString(), expiry.toISOString());
    await assert.rejects(subscribe("Unsupported"), { code: "22023" });
    const first = (await db.query("select * from public.vip_demo_passes")).rows[0];
    assert.equal(first.plan, "Basic");
    assert.equal(first.expires_at - first.started_at, 30 * 24 * 60 * 60 * 1000);
    await assert.rejects(db.query("update public.vip_demo_passes set expires_at = now()"), { code: "42501" });
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    assert.equal((await db.query("select * from public.vip_demo_passes")).rows.length, 0);
    await db.exec("reset role");
    await db.exec("update public.vip_demo_passes set started_at = now() - interval '40 days', expires_at = now() - interval '10 days'");
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    assert.ok(await subscribe() > Date.now());
  } finally {
    await db.close();
  }
});

test("Supabase stores verified payments once, extends each paid pass, and keeps rows private", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create schema auth;create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated;insert into auth.users values ('${user}'),('${other}');`);
    await db.exec(await readFile(new URL("../supabase/migrations/20261119_vip_payments.sql", import.meta.url), "utf8"));
    await db.exec("set role service_role");
    for (const [id, session] of [[order, "cs_first"], [renewal, "cs_second"]]) {
      await db.query("insert into public.vip_payments(id,user_id,amount,live,method,session_id) values ($1,$2,17900,true,'gcash',$3)", [id, user, session]);
    }
    const confirm = async (id, session, payment, amount, live) => (await db.query(
      "select public.confirm_vip_payment($1,$2,$3,$4,'PHP',$5,'2030-01-01T00:00:00Z') as done",
      [id, session, payment, amount, live]
    )).rows[0].done;
    assert.equal(await confirm(order, "cs_wrong", "pay_first", 17900, true), false);
    assert.equal(await confirm(order, "cs_first", "pay_first", 1, true), false);
    assert.equal(await confirm(order, "cs_first", "pay_first", 17900, false), false);
    assert.equal(await confirm(order, "cs_first", "pay_first", 17900, true), true);
    assert.equal(await confirm(order, "cs_first", "pay_first", 17900, true), true);
    assert.equal(await confirm(renewal, "cs_second", "pay_second", 17900, true), true);
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    assert.equal((await db.query("select * from public.vip_payments")).rows.length, 0);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    const { rows } = await db.query("select * from public.vip_payments");
    assert.equal(rows.length, 2);
    assert.equal(rows.find(row => row.id === renewal).access_until.toISOString(), "2030-03-02T00:00:00.000Z");
    await assert.rejects(db.query("update public.vip_payments set status='paid'"), { code: "42501" });
    await assert.rejects(confirm(order, "cs_first", "pay_first", 17900, true), { code: "42501" });
    await db.exec("set role anon");
    await assert.rejects(db.query("select * from public.vip_payments"), { code: "42501" });
  } finally {
    await db.close();
  }
});
