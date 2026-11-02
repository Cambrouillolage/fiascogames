-- Annuaire public des boutiques qui vendent GAV (carte "Trouver une
-- boutique" sur gav/index.html). Contrairement à shop_requests (demandes
-- privées de boutiques voulant être contactées), cette table est conçue
-- pour être lue publiquement par tous les visiteurs du site (anon), afin
-- d'afficher la carte sans authentification.
--
-- Gestion : Florian/Galane ajoutent, modifient ou désactivent les
-- boutiques directement depuis le Table Editor du Dashboard Supabase
-- (accès propriétaire du projet, qui contourne RLS — aucune policy
-- d'écriture n'est donc nécessaire ici). Les photos sont uploadées à la
-- main dans le bucket de stockage "shop-photos" (public), puis l'URL
-- publique obtenue est collée dans la colonne photo_url.

insert into storage.buckets (id, name, public)
values ('shop-photos', 'shop-photos', true)
on conflict (id) do nothing;

create table public.shop_directory (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  address text,
  postal_code text not null,
  city text not null,
  latitude double precision not null,
  longitude double precision not null,
  photo_url text,
  website_url text,
  is_active boolean not null default true
);

create index shop_directory_postal_code_idx on public.shop_directory (postal_code);
create index shop_directory_city_idx on public.shop_directory (lower(city));

alter table public.shop_directory enable row level security;

-- Seules les boutiques actives sont lisibles, par n'importe qui (anon
-- compris) : c'est nécessaire pour que la carte s'affiche côté visiteur.
create policy "public can read active shops"
  on public.shop_directory for select
  to anon, authenticated
  using (is_active = true);
