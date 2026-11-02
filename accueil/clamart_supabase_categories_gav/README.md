# Supabase — Catégories / sous-catégories / verrouillage GAV

Contenu : **15 grandes catégories** et **181 sous-catégories**. Les sous-catégories réutilisent les **102 badges métiers/lieux** existants (le badge `cadenas` n'est pas une catégorie), avec des sous-catégories supplémentaires disposant d'un badge de repli existant.

- `01_categories_principales.csv` : labels, slugs, couleur et badge par défaut, indicateur 'verrouillable' pour l'import.
- `02_sous_categories.csv` : liens parent/enfant et badge associé.
- `03_catalogue_hierarchique.csv` : parent et sous-catégorie dans un format commun à une table auto-référente (`parent_id`).
- `04_MODELE_commerces_A_REMPLIR.csv` : seulement en-têtes, zéro commerce fictif.
- `05_migration_clamart_merchants.sql` : mise à jour additive pour la table `clamart_merchants` existante ; ne modifie pas `clamart_categories` ni les droits d'accès.
- `06_PROMPT_CLAUDE_CODE.md` : instructions détaillées de migration et d'UX.

**ATTENTION :** nous ne disposons pas du schéma SQL complet de `clamart_categories`. Ne pas importer directement le catalogue avant qu'il soit adapté à la structure et que les éventuels IDs existants soient réconciliés. Les IDs de catégorie présents dans le CSV sont des propositions ; conserver la compatibilité avec les FKs existantes. Le `public_landmark_hint` est seulement un indice de pré-classement, jamais une décision automatique ; une activité privée peut partager la sous-catégorie d'un lieu public. Le badge `sante` utilise la sous-catégorie `sante_generale` pour éviter une collision d'identifiants avec la catégorie parente `sante` dans une table hiérarchique unique.

Le verrouillage GAV est conçu comme une mécanique commerciale de découverte, pas une méthode de secret des données publiques. Ne pas afficher au public les valeurs brutes de `name` pour les commerces masqués ; vérifier droits/RLS et endpoints. Le placement exact sur une carte peut suffire à identifier un commerce.
