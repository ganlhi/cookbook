# Objectif

Créer une application pour téléphone ou tablette (PWA installable, cible principale iPhone/iPad), permettant d'indexer des recettes de cuisines se trouvant dans des livres ou d'insérer directement les recettes dans l'application.

> Note : une première implémentation en app iOS native (SwiftUI + SwiftData) est archivée sur la branche `ios-app`. Elle a été abandonnée pour éviter le compte développeur Apple payant ; la PWA offre les mêmes fonctionnalités sans distribution App Store.

Deux types d'ajouts possible : 
- une recette avec un titre, une liste des ingrédients principaux, un titre de livre et une page
- une recette avec un titre, une liste des ingrédients principaux, des instructions pour faire la recette au format Markdown

Lors de l'ajout, les titres de livres déjà utilisés sont suggérés, de même que les aliments.

Tout est local, pas de base de données externe à l'application.

Possibilité d'exporter tout où partie des recettes sous la forme d'un fichier unique partageable pour pouvoir l'importer dans l'application sur un autre appareil.

Consultation des recettes : 
- liste filtrable par ingrédients, par partie du titre (fuzzy search)
- affichage des instructions pour les recettes qui en disposent dans un format agréable à lire (rendu du contenu Markdown).

# Plan

## Stack technique

- **PWA statique, vanilla JS (modules ES), sans build ni dépendance** — déployable telle quelle (GitHub Pages ou n'importe quel hébergeur statique, HTTPS requis pour l'installation)
- **IndexedDB** pour la persistance locale (les données restent sur l'appareil)
- **Service worker** pour le fonctionnement hors-ligne, **manifest** pour l'installation sur l'écran d'accueil (iOS : « Ajouter à l'écran d'accueil »)
- Rendu Markdown et fuzzy search implémentés à la main (mêmes algorithmes que la version iOS archivée)

## Modèle de données

Un seul type `Recipe`, stocké dans un store IndexedDB unique ; livres et ingrédients sont **dérivés** des recettes (pas de stores séparés, la déduplication par nom est calculée) :

```js
{
  id,                    // généré
  title,
  createdAt,             // ISO 8601
  ingredients: ["..."],  // noms normalisés (minuscules, trim)
  book,  page,           // référence livre (exclusif avec instructions)
  instructionsMarkdown,  // recette complète
}
```

## Écrans (SPA centrée sur la liste)

L'usage principal est la consultation de la liste : la plupart des recettes sont de simples références à des livres, et une ligne suffit à les afficher en entier. Il n'y a donc pas de volet détail.

1. **Liste des recettes** (écran unique) — recherche fuzzy sur le titre (sous-séquence avec score, insensible accents/casse), filtres multi-ingrédients (chips, intersection). Chaque ligne porte le titre, le livre + page, les ingrédients, et un bouton « ⋯ » ouvrant modifier / supprimer
2. **Popup de recette** — uniquement pour les recettes à contenu : un clic sur la ligne affiche les instructions Markdown rendues (titres, listes, gras/italique) et les chips d'ingrédients. Les références livre ne sont pas cliquables, tout est déjà dans la ligne
3. **Ajout / édition** — dialog avec choix du type, saisie des ingrédients en tags avec suggestions, auto-complétion des titres de livres
4. **Export / import** — export JSON de tout ou d'une sélection (téléchargement + Web Share si dispo) ; import avec déduplication des recettes identiques et récapitulatif

Mise en page pensée pour le portrait : une seule colonne occupant toute la largeur du viewport. La coquille `.app` est `position: fixed` sur le viewport (pas de `dvh`, dont l'absence de support cassait le défilement) et seule la liste défile. Thème clair/sombre via `prefers-color-scheme`.

## Format d'export

Identique à la version iOS archivée (interopérable), fichier `recettes.cookbook.json` :

```json
{
  "version": 1,
  "recipes": [
    { "title": "...", "ingredients": ["..."], "book": "...", "page": 42 },
    { "title": "...", "ingredients": ["..."], "instructionsMarkdown": "..." }
  ]
}
```

## Structure des fichiers

```
index.html            # shell de l'app
style.css             # styles (clair/sombre, responsive)
logic.js              # fonctions pures : fuzzy search, markdown, dédup import (testées via node)
app.js                # DOM, état, IndexedDB, export/import
sw.js                 # service worker (cache offline)
manifest.webmanifest  # installation PWA
icons/                # icônes PNG (192, 512, apple-touch-icon 180)
```