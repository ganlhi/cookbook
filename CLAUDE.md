# Objectif

Créer une application iOS pour téléphone ou tablette, permettant d'indexer des recettes de cuisines se trouvant dans des livres ou d'insérer directement les recettes dans l'application.

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

- **SwiftUI** pour l'interface (iPhone + iPad, adaptatif via `NavigationSplitView`)
- **SwiftData** pour la persistance locale (iOS 17+, pas de dépendance externe)
- **Swift 5.9+ / Xcode 15+**, aucune bibliothèque tierce : rendu Markdown via `AttributedString(markdown:)` étendu, ou implémentation légère maison pour les titres/listes
- Export/import via `Transferable` + `ShareLink` / `fileImporter`

## Modèle de données (SwiftData)

```swift
@Model class Recipe {
    var title: String
    var createdAt: Date
    var ingredients: [Ingredient]      // many-to-many
    // Référence livre (mutuellement exclusif avec instructions, validé à la saisie)
    var book: Book?
    var page: Int?
    // Recette complète
    var instructionsMarkdown: String?
}

@Model class Ingredient {
    @Attribute(.unique) var name: String   // normalisé (minuscules, trim)
    var recipes: [Recipe]
}

@Model class Book {
    @Attribute(.unique) var title: String
    var recipes: [Recipe]
}
```

Un seul type `Recipe` avec champs optionnels plutôt que deux entités : simplifie la liste, la recherche et l'export. Une propriété calculée `kind` (`.bookReference` / `.fullRecipe`) distingue les deux cas à l'affichage.

## Écrans

1. **Liste des recettes** (écran principal)
   - Barre de recherche : fuzzy search sur le titre (algorithme de subsequence matching avec score, en mémoire — volume faible, pas besoin d'index)
   - Filtres par ingrédients : sélection multiple (chips), intersection des recettes
   - Badge visuel distinguant référence livre / recette complète
2. **Détail d'une recette**
   - Référence livre : titre, ingrédients, livre + page
   - Recette complète : titre, ingrédients, instructions Markdown rendues (styles titres, listes, gras/italique)
3. **Ajout / édition**
   - Choix du type au départ (segmented control)
   - Auto-complétion des livres : suggestions filtrées sur les `Book` existants au fil de la frappe
   - Auto-complétion des ingrédients : idem sur les `Ingredient` existants, saisie sous forme de tags
4. **Export / import**
   - Export : sélection multiple dans la liste (ou « tout »), génération d'un fichier JSON (`.cookbook`), partage via `ShareLink`
   - Import : `fileImporter`, fusion par déduplication (ingrédients et livres par nom, recettes par titre + contenu — proposer « ignorer / dupliquer » en cas de conflit)

## Format d'export

JSON versionné, autoporteur (pas d'IDs SwiftData) :

```json
{
  "version": 1,
  "recipes": [
    { "title": "...", "ingredients": ["..."], "book": "...", "page": 42 },
    { "title": "...", "ingredients": ["..."], "instructionsMarkdown": "..." }
  ]
}
```

Les livres et ingrédients sont reconstruits à l'import à partir des noms — pas besoin de les sérialiser séparément.

## Étapes d'implémentation

1. Projet Xcode SwiftUI + SwiftData, modèles et container
2. Liste des recettes + ajout basique (les deux types, sans auto-complétion)
3. Auto-complétion livres et ingrédients (tags)
4. Détail avec rendu Markdown
5. Fuzzy search + filtres par ingrédients
6. Export / import JSON avec déduplication
7. Polissage iPad (`NavigationSplitView`), édition/suppression, états vides