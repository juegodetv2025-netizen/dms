-- Licencias DMS. Ejecutar en Supabase > SQL Editor.
-- RLS activado SIN políticas: solo el servidor (service_role) accede.

create extension if not exists pgcrypto;

create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan        text not null default 'standard',
  status      text not null default 'active' check (status in ('active','suspended','expired')),
  expires_at  timestamptz not null,
  max_devices int not null default 1 check (max_devices > 0),
  created_at  timestamptz not null default now()
);

-- Se guarda el hash (sha256 hex) del código y del token, nunca el valor en claro.
create table if not exists activation_codes (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  code_hash   text not null unique,
  label       text,                       -- placa / nombre del vehículo
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists devices (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  label       text,
  token_hash  text not null unique,
  status      text not null default 'active' check (status in ('active','revoked')),
  last_seen   timestamptz,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

create index if not exists devices_customer_idx on devices(customer_id);
create index if not exists codes_customer_idx on activation_codes(customer_id);

alter table customers        enable row level security;
alter table activation_codes enable row level security;
alter table devices          enable row level security;

revoke all on customers, activation_codes, devices from anon, authenticated;
