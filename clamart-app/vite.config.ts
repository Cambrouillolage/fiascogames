import { defineConfig } from 'vite';

// Servi à fiascogames.fr/clamart/ ; le build sort directement dans le
// dossier `clamart/` au même niveau que `gav/`, au lieu du `dist/` par
// défaut, pour que le site puisse le déployer tel quel.
export default defineConfig({
  base: '/clamart/',
  build: {
    outDir: '../clamart',
    emptyOutDir: true,
  },
});
