alter table public.vip_demo_passes
  add column plan text not null default 'Standard' check (plan in ('Basic', 'Standard', 'Premium'));

create function public.subscribe_vip(selected_plan text) returns timestamptz
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
  if selected_plan is null or selected_plan not in ('Basic', 'Standard', 'Premium') then
    raise exception 'Invalid membership plan' using errcode = '22023';
  end if;

  -- Plan changes keep the current expiry.
  insert into public.vip_demo_passes as passes (user_id, started_at, expires_at, plan)
    values (owner_id, subscribed_at, subscribed_at + interval '30 days', selected_plan)
    on conflict (user_id) do update
      set plan = excluded.plan,
          started_at = case when passes.expires_at <= subscribed_at then excluded.started_at else passes.started_at end,
          expires_at = case when passes.expires_at <= subscribed_at then excluded.expires_at else passes.expires_at end
    returning expires_at into expiry;
  return expiry;
end;
$$;
revoke all on function public.subscribe_vip(text) from public, anon, authenticated;
grant execute on function public.subscribe_vip(text) to authenticated;
