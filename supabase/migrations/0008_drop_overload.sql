-- 0008_drop_overload.sql — 0006 added p_currency with CREATE OR REPLACE, which
-- created a 5-arg overload alongside the 6-arg one; unresolvable candidates broke
-- every RPC call. Drop the stale signature (defaults cover subset calls).
drop function if exists public.fn_apply_payment_result(uuid, text, text, text, bigint);
