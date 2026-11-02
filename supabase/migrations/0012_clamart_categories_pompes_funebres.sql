-- Sous-catégorie manquante repérée lors de la préparation du premier import
-- de commerces (3 établissements de pompes funèbres, taxonomie fournie n'en
-- prévoyait pas). Additive, même schéma que 0008.
BEGIN;

INSERT INTO public.clamart_categories (id, label, emoji, color, parent_id, sort_order, badge_id, public_landmark_hint) VALUES
  ('pompes_funebres', 'Pompes funèbres', '🏷️', '#6b7280', 'services', 0, 'cimetiere', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
