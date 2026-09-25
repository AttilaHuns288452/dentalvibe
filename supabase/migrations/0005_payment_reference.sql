-- 0005_payment_reference.sql — in-store QRPh linkage + display style.
-- In-store QRPh is a STATIC merchant QR: the customer enters the amount, so
-- no per-payment provider object exists at creation. Linkage to the internal
-- payment record = optional payer reference + amount + time-window matching on
-- the webhook / reconciliation path.
alter table public.payments
  add column if not exists reference text,
  add column if not exists test_url text;   -- PayMongo test-mode simulation URL
