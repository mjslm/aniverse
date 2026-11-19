create table public.vip_payments (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null check (amount > 0),
  currency text not null default 'PHP' check (currency = 'PHP'),
  live boolean not null,
  method text not null check (method in ('gcash', 'paymaya', 'card')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'refunded', 'failed')),
  session_id text unique,
  payment_id text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  access_until timestamptz
);
create index vip_payments_owner on public.vip_payments (user_id, created_at desc);
alter table public.vip_payments enable row level security;
revoke all on public.vip_payments from public, anon, authenticated;
grant select on public.vip_payments to authenticated;
grant select, insert, update on public.vip_payments to service_role;
create policy vip_payments_select_own on public.vip_payments
  for select to authenticated using ((select auth.uid()) = user_id);

create function public.confirm_vip_payment(
  order_id uuid, checkout_id text, provider_payment_id text,
  paid_amount integer, paid_currency text, is_live boolean, provider_paid_at timestamptz
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  purchase public.vip_payments;
  previous_expiry timestamptz;
begin
  select * into purchase from public.vip_payments where id = order_id for update;
  if not found or purchase.session_id is distinct from checkout_id
    or purchase.amount <> paid_amount or purchase.currency <> paid_currency
    or purchase.live <> is_live or provider_paid_at is null then
    return false;
  end if;

  if purchase.status in ('paid', 'refunded') then
    return purchase.payment_id = provider_payment_id;
  end if;
  if purchase.status <> 'pending' then return false; end if;

  -- Serialize renewals so two payments never overwrite the same 30 days.
  perform pg_advisory_xact_lock(hashtextextended(purchase.user_id::text || purchase.live::text, 0));
  select max(access_until) into previous_expiry
    from public.vip_payments
    where user_id = purchase.user_id and live = purchase.live and status = 'paid';

  update public.vip_payments
    set payment_id = provider_payment_id, status = 'paid', paid_at = provider_paid_at,
        access_until = greatest(previous_expiry, provider_paid_at) + interval '30 days'
    where id = order_id;
  return true;
end;
$$;
revoke all on function public.confirm_vip_payment(uuid, text, text, integer, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.confirm_vip_payment(uuid, text, text, integer, text, boolean, timestamptz) to service_role;
