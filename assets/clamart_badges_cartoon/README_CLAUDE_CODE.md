# Pack de badges cartoon — Clamart

**97 badges individuels**, nommés et classés par grande catégorie.

## Contenu

- `public/badges/<categorie>/<id>.png` — PNG **256 × 256 px**, fond transparent en dehors du rond ; aucune pointe de carte, aucun bâtiment support.
- `public/badges_webp/<categorie>/<id>.webp` — version **128 × 128 px**, plus légère, pour les marqueurs visibles en nombre sur mobile.
- `badges.manifest.json` — catalogue structuré avec nom français, catégorie, couleur et chemins.
- `badges.csv` — même catalogue en tableau éditable.
- `badgesClamart.ts` — tableau TypeScript prêt à importer.
- `APERCU_BADGES.png` — planche de prévisualisation de toutes les icônes.

## Installation (Claude Code / Next.js / React / Vite)

1. Copier le contenu du dossier `public/` dans le dossier `public/` du projet web.
2. Déplacer `badgesClamart.ts` dans un dossier `src/data/` du projet.
3. Associer un commerce à un badge grâce au champ `badge_id`, par exemple `fleuriste`, `boucherie` ou `mairie`.
4. Retrouver le fichier dans `badgesParId[commerce.badge_id]?.webp` (ou `.png`).
5. Afficher l'image via une balise `<img>` ou un composant de marqueur de la librairie de carte déjà installée.

Exemple :

```tsx
import { badgesParId } from './data/badgesClamart';

const badge = badgesParId[commerce.badge_id] ?? badgesParId.boutique;
// Dans le composant du marqueur :
<img src={badge.webp} alt={badge.nom} width={48} height={48} />
```

## Prompt court pour Claude Code

> Importe le pack de badges Clamart fourni. Ne régénère aucune icône. Utilise les fichiers individuels WebP 128x128 pour les marqueurs sur la carte, et les PNG 256x256 dans les fiches détaillées. Ajoute un champ `badge_id` au modèle commerçant, relié aux identifiants de `badgesClamart.ts`, avec un sélecteur visuel dans l'administration. Utilise une taille de marqueur de 44–52 px sur mobile, conserve le fond transparent et n'ajoute pas de pointe de géolocalisation. Ne modifie ni les coordonnées ni le style de la carte existante.

## Règles visuelles

Le badge **est le rond lui-même**. Ne pas ajouter un second rond, fond coloré, bâtiment 3D ou pointeur en forme de goutte autour. Il ne doit pas servir à placer un commerce fictif : seul le commerçant réel de la base de données reçoit un marqueur.

## Remarque qualité

Les PNG sont extraits de planches illustrées puis découpés avec un masque circulaire. Les originaux du pack ont une définition raster, non vectorielle ; les PNG 256 px sont destinés à l'affichage numérique, pas à l'impression grand format.
