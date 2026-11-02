-- Catégories de commerçants pour l'annuaire de la carte cartoon de Clamart
-- (clamart-app/). Table à part de shop_directory (boutiques qui vendent le
-- jeu GAV, sujet différent).
--
-- parent_id prépare les sous-catégories (ex. Restaurants -> Italien,
-- Japonais...) sans construire leur interface tout de suite : une catégorie
-- principale a parent_id = null, une sous-catégorie référence sa catégorie
-- principale. Pas encore de sous-catégories insérées dans ce seed.

create table public.clamart_categories (
  id text primary key,
  label text not null,
  emoji text not null,
  color text not null,
  parent_id text references public.clamart_categories (id),
  sort_order integer not null default 0
);

insert into public.clamart_categories (id, label, emoji, color, sort_order) values
  ('restaurants', 'Restaurants & alimentation',   '🍽️', '#e8734a', 1),
  ('beaute',      'Beauté, soins & bien-être',     '💆', '#d88fc0', 2),
  ('shopping',    'Shopping & boutiques',          '🛍️', '#f0b429', 3),
  ('services',    'Services & utilitaires',        '🔧', '#6b7280', 4),
  ('sante',       'Santé',                         '🏥', '#e05252', 5),
  ('loisirs',     'Loisirs, culture & sorties',    '🎭', '#7c5cd4', 6),
  ('maison',      'Maison & décoration',           '🏠', '#8a6b4f', 7),
  ('sport',       'Sport & fitness',               '🏋️', '#3fa65f', 8),
  ('education',   'Éducation & enfance',           '📚', '#3f8fd4', 9),
  ('autres',      'Autres',                        '📍', '#9ca3af', 10);

alter table public.clamart_categories enable row level security;

-- Lues par tout le monde (anon compris) : nécessaire pour afficher les
-- filtres sur la carte publique sans authentification.
create policy "public can read categories"
  on public.clamart_categories for select
  to anon, authenticated
  using (true);

-- Seule l'admin peut créer/modifier/supprimer des catégories (même
-- prédicat que shop_directory_stock, même compte).
create policy "admin can manage categories"
  on public.clamart_categories for all
  to authenticated
  using (auth.jwt() ->> 'email' = 'florian@fiascogames.fr')
  with check (auth.jwt() ->> 'email' = 'florian@fiascogames.fr');
