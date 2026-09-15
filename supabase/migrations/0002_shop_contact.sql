-- Demandes de contact "boutique" : stockage des leads envoyés depuis le
-- bouton "Je suis une boutique" / "Boutique" du site. Aucune policy
-- publique n'est créée : seule l'Edge Function "shop-contact" (clé service
-- role, qui contourne RLS) écrit dans cette table. Voir
-- supabase/functions/shop-contact/index.ts.

create extension if not exists pgcrypto;

create table public.shop_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nom text not null,
  prenom text not null,
  boutique text not null,
  email text not null,
  telephone text not null,
  client_ip inet
);

create index shop_requests_created_at_idx
  on public.shop_requests (created_at desc);

create index shop_requests_client_ip_created_at_idx
  on public.shop_requests (client_ip, created_at);

alter table public.shop_requests enable row level security;

-- Aucune policy select/insert n'est créée ici : ni anon ni authenticated
-- n'ont d'accès direct. La lecture se fait pour l'instant via le dashboard
-- Supabase (service role) ; l'écriture uniquement via l'Edge Function.
