-- Étend l'annuaire des boutiques (shop_directory, voir 0003) pour la carte
-- interactive de Clamart (gav/clamart/) : thématique, stock de GAV
-- disponible, et compteur de ventes pour le classement. Ce sont les mêmes
-- boutiques que l'annuaire national, pas une table séparée.
--
-- Gestion : contrairement au reste de shop_directory (modifié uniquement
-- via le Table Editor par Florian/Galane, accès propriétaire qui contourne
-- RLS), ces nouvelles colonnes sont éditées depuis une vraie page d'admin
-- du site (gav/admin/shops/), qui s'authentifie via Supabase Auth comme un
-- utilisateur normal — d'où les policies RLS ci-dessous, nécessaires pour
-- que cette page puisse lire/écrire.

alter table public.shop_directory
  add column category text,
  add column stock_quantity integer not null default 0,
  add column units_sold integer not null default 0,
  add column stock_updated_at timestamptz;

alter table public.shop_directory
  add constraint shop_directory_stock_quantity_nonneg check (stock_quantity >= 0),
  add constraint shop_directory_units_sold_nonneg check (units_sold >= 0);

-- L'admin doit voir TOUTES les boutiques de Clamart, y compris celles
-- désactivées (is_active = false) — sinon une boutique désactivée
-- disparaîtrait silencieusement de la page d'admin. La policy publique
-- existante ("public can read active shops", voir 0003) ne couvre que
-- is_active = true ; celle-ci s'y ajoute (RLS combine les policies
-- permissives SELECT avec OR, donc anon n'est pas affecté).
create policy "admin can read all shops"
  on public.shop_directory for select
  to authenticated
  using (auth.jwt() ->> 'email' = 'florian@fiascogames.fr');

-- Seule l'admin peut modifier (même prédicat que 0001_gav_chat.sql).
create policy "admin can update shop stock"
  on public.shop_directory for update
  to authenticated
  using (auth.jwt() ->> 'email' = 'florian@fiascogames.fr')
  with check (auth.jwt() ->> 'email' = 'florian@fiascogames.fr');

-- Durcissement : même avec la policy ci-dessus, limiter quelles colonnes
-- un utilisateur authentifié peut toucher via UPDATE (jamais
-- latitude/longitude/website_url/is_active par erreur depuis la page
-- d'admin).
revoke update on public.shop_directory from authenticated;
grant update (category, stock_quantity, units_sold, stock_updated_at)
  on public.shop_directory to authenticated;
