import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("actual SQL schema denies anonymous access and isolates all five tables between two accounts", async () => {
  const db = new PGlite(), a = "11111111-1111-4111-8111-111111111111", b = "22222222-2222-4222-8222-222222222222";
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema public,auth to anon,authenticated;insert into auth.users values ('${a}'),('${b}');`);
    await db.exec(fs.readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8"));
    await db.exec("set role anon");
    for (const table of ["profiles", "watchlist", "watch_progress", "user_settings", "user_notes"]) await assert.rejects(db.query(`select * from public.${table}`), (e) => e.code === "42501");
    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
    await db.query("insert into public.profiles(id,display_name) values ($1,'Alice')", [a]);
    await db.query("insert into public.watchlist(user_id,anime_id,status) values ($1,'aot','Watching')", [a]);
    await db.query("insert into public.watch_progress(user_id,episode_key,seconds,duration) values ($1,'aot:s4p3:29',12,30)", [a]);
    await db.query("insert into public.user_settings(user_id) values ($1)", [a]);
    await db.query("insert into public.user_notes(user_id,id,anime_id,body) values ($1,$1,'aot','Private')", [a]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [b]);
    for (const table of ["profiles", "watchlist", "watch_progress", "user_settings", "user_notes"]) assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0, table);
    await assert.rejects(db.query("insert into public.watchlist(user_id,anime_id,status) values ($1,'demon','Watching')", [a]), (e) => e.code === "42501");
    assert.equal((await db.query("update public.watchlist set status='Completed' where user_id=$1 returning *", [a])).rows.length, 0);
    assert.equal((await db.query("delete from public.user_notes where user_id=$1 returning *", [a])).rows.length, 0);
    await db.query("insert into public.watchlist(user_id,anime_id,status) values ($1,'aot','Plan to Watch')", [b]);
    await assert.rejects(db.query("update public.watchlist set user_id=$1 where user_id=$2", [a, b]), (e) => e.code === "42501");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
    const rows = (await db.query("select * from public.watchlist")).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "Watching");
    assert.equal((await db.query("update public.watchlist set status='Completed' returning *")).rows[0].status, "Completed");
    assert.equal((await db.query("delete from public.user_notes returning *")).rows.length, 1);
  } finally {
    await db.close();
  }
});
