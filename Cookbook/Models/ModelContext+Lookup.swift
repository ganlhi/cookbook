import Foundation
import SwiftData

extension ModelContext {
    /// Retourne l'ingrédient existant portant ce nom (normalisé), ou le crée.
    func ingredient(named raw: String) -> Ingredient {
        let name = Ingredient.normalized(raw)
        let descriptor = FetchDescriptor<Ingredient>(predicate: #Predicate { $0.name == name })
        if let existing = try? fetch(descriptor).first {
            return existing
        }
        let ingredient = Ingredient(name: name)
        insert(ingredient)
        return ingredient
    }

    /// Retourne le livre existant portant ce titre, ou le crée.
    func book(titled raw: String) -> Book {
        let title = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let descriptor = FetchDescriptor<Book>(predicate: #Predicate { $0.title == title })
        if let existing = try? fetch(descriptor).first {
            return existing
        }
        let book = Book(title: title)
        insert(book)
        return book
    }

    /// Supprime les ingrédients et livres qui ne sont plus référencés par aucune recette.
    func cleanupOrphans() {
        try? save()
        if let ingredients = try? fetch(FetchDescriptor<Ingredient>()) {
            for ingredient in ingredients where ingredient.recipes.isEmpty {
                delete(ingredient)
            }
        }
        if let books = try? fetch(FetchDescriptor<Book>()) {
            for book in books where book.recipes.isEmpty {
                delete(book)
            }
        }
    }
}
