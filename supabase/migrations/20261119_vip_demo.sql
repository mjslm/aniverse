create table public.vip_demo_passes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > started_at)
);
alter table public.vip_demo_passes enable row level security;
revoke all on public.vip_demo_passes from public, anon, authenticated;
grant select on public.vip_demo_passes to authenticated;
create policy vip_demo_read_own on public.vip_demo_passes
  for select to authenticated using ((select auth.uid()) = user_id);

create function public.subscribe_demo_vip() returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  subscribed_at timestamptz := now();
  expiry timestamptz;
begin
  if owner_id is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'Sign in to subscribe' using errcode = '42501';
  end if;

  -- Repeated clicks keep the current pass expiry.
  insert into public.vip_demo_passes as passes (user_id, started_at, expires_at)
    values (owner_id, subscribed_at, subscribed_at + interval '30 days')
    on conflict (user_id) do update
      set started_at = excluded.started_at, expires_at = excluded.expires_at
      where passes.expires_at <= subscribed_at;

  select expires_at into expiry from public.vip_demo_passes where user_id = owner_id;
  return expiry;
end;
$$;
revoke all on function public.subscribe_demo_vip() from public, anon, authenticated;
grant execute on function public.subscribe_demo_vip() to authenticated;
