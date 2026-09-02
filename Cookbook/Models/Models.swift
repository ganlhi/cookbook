import Foundation
import SwiftData

enum RecipeKind {
    case bookReference
    case fullRecipe
}

@Model
final class Recipe {
    var title: String
    var createdAt: Date
    var ingredients: [Ingredient]
    var book: Book?
    var page: Int?
    var instructionsMarkdown: String?

    init(
        title: String,
        createdAt: Date = .now,
        ingredients: [Ingredient] = [],
        book: Book? = nil,
        page: Int? = nil,
        instructionsMarkdown: String? = nil
    ) {
        self.title = title
        self.createdAt = createdAt
        self.ingredients = ingredients
        self.book = book
        self.page = page
        self.instructionsMarkdown = instructionsMarkdown
    }

    var kind: RecipeKind {
        book != nil ? .bookReference : .fullRecipe
    }
}

@Model
final class Ingredient {
    @Attribute(.unique) var name: String
    @Relationship(inverse: \Recipe.ingredients) var recipes: [Recipe]

    init(name: String) {
        self.name = Ingredient.normalized(name)
        self.recipes = []
    }

    static func normalized(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

@Model
final class Book {
    @Attribute(.unique) var title: String
    @Relationship(inverse: \Recipe.book) var recipes: [Recipe]

    init(title: String) {
        self.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        self.recipes = []
    }
}
