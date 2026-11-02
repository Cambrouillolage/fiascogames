-- Annuaire des commerçants affichés sur la carte cartoon de Clamart
-- (clamart-app/), géré depuis gav/admin/clamart/. Contrairement à
-- shop_directory (ajout/suppression à la main dans le Table Editor), cette
-- table a un vrai CRUD web complet, d'où des policies INSERT/UPDATE/DELETE
-- (pas seulement SELECT/UPDATE partiel comme shop_directory_stock).

insert into storage.buckets (id, name, public)
values ('clamart-merchant-photos', 'clamart-merchant-photos', true)
on conflict (id) do nothing;

create table public.clamart_merchants (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  name text not null,
  category_id text not null references public.clamart_categories (id),
  subcategory_id text references public.clamart_categories (id),
  description text,

  address text,
  postal_code text,
  city text not null default 'Clamart',

  lat double precision,
  lon double precision,
  -- Si true, une regénération de position à partir de l'adresse (bouton
  -- "Géocoder" dans l'admin) ne doit PAS écraser lat/lon : la position a
  -- été validée/corrigée à la main.
  position_is_manual boolean not null default false,

  photo_url text,
  status text not null default 'active' check (status in ('active', 'inactive')),

  pointer_type text not null default 'pin',
  badge_icon text,   -- emoji/icône ; si null, on prend celui de category_id
  badge_color text,  -- hex ; si null, on prend celle de category_id

  website text
);

create index clamart_merchants_category_idx on public.clamart_merchants (category_id);
create index clamart_merchants_status_idx on public.clamart_merchants (status);

alter table public.clamart_merchants enable row level security;

-- La carte publique ne doit voir que les commerçants actifs.
create policy "public can read active merchants"
  on public.clamart_merchants for select
  to anon, authenticated
  using (status = 'active');

-- L'admin doit voir aussi les commerçants désactivés (sinon ils
-- disparaîtraient silencieusement du tableau d'admin). RLS combine les
-- policies SELECT permissives avec OR, donc anon n'est pas affecté par
-- celle-ci.
create policy "admin can read all merchants"
  on public.clamart_merchants for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'florian@fiascogames.fr');

-- CRUD complet (insert/update/delete), réservé à l'admin.
create policy "admin can write merchants"
  on public.clamart_merchants for all
  to authenticated
  using (auth.jwt() ->> 'email' = 'florian@fiascogames.fr')
  with check (auth.jwt() ->> 'email' = 'florian@fiascogames.fr');
