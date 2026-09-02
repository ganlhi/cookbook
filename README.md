# Cookbook — Recettes

Index de recettes de cuisine : références vers vos livres (titre + page) ou recettes complètes en Markdown. **PWA 100 % locale** — aucune donnée ne quitte l'appareil, aucun serveur applicatif.

## Fonctionnalités

- Deux types de recettes : référence livre (titre, ingrédients, livre + page) ou recette complète (instructions Markdown rendues)
- Recherche floue sur le titre (insensible aux accents), filtres multi-ingrédients
- Auto-complétion des livres et ingrédients déjà saisis
- Export/import de tout ou partie des recettes en un fichier JSON (`recettes.cookbook.json`), interopérable avec l'app iOS native archivée sur la branche [`ios-app`](../../tree/ios-app)
- Hors-ligne complet (service worker), thème clair/sombre, iPhone/iPad/desktop

## Développement local

Aucun build, aucune dépendance :

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Tests de la logique métier :

```bash
node --test
```

## Déploiement

N'importe quel hébergeur statique en HTTPS. Avec GitHub Pages : Settings → Pages → Deploy from branch → `main`, dossier `/ (root)`.

Après chaque modification déployée, incrémenter `CACHE_NAME` dans [sw.js](sw.js) pour que les clients installés se mettent à jour.

## Installation sur iPhone / iPad

1. Ouvrir l'URL dans Safari
2. Bouton Partager → **« Sur l'écran d'accueil »**
3. L'app s'ouvre en plein écran et fonctionne hors-ligne

Les données vivent dans le navigateur (IndexedDB). Pensez à faire un export JSON de temps en temps en guise de sauvegarde, et pour synchroniser plusieurs appareils.
