import Foundation
import SwiftData
import CoreTransferable
import UniformTypeIdentifiers

/// Format de fichier d'export, versionné et autoporteur (pas d'IDs internes) :
/// livres et ingrédients sont reconstruits par nom à l'import.
struct ExportDocument: Codable {
    var version: Int
    var recipes: [RecipeDTO]
}

struct RecipeDTO: Codable, Hashable {
    var title: String
    var ingredients: [String]
    var book: String?
    var page: Int?
    var instructionsMarkdown: String?

    init(recipe: Recipe) {
        title = recipe.title
        ingredients = recipe.ingredients.map(\.name).sorted()
        book = recipe.book?.title
        page = recipe.page
        instructionsMarkdown = recipe.instructionsMarkdown
    }
}

struct CookbookExport: Transferable {
    var recipes: [RecipeDTO]

    var data: Data {
        get throws {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            return try encoder.encode(ExportDocument(version: 1, recipes: recipes))
        }
    }

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .json) { export in
            try export.data
        }
        .suggestedFileName("recettes.cookbook.json")
    }
}

enum RecipeImporter {
    struct Summary {
        var imported = 0
        var skipped = 0
    }

    /// Importe un fichier d'export en ignorant les recettes strictement identiques
    /// (même titre, mêmes ingrédients, même livre/page ou mêmes instructions).
    static func importData(_ data: Data, into context: ModelContext) throws -> Summary {
        let document = try JSONDecoder().decode(ExportDocument.self, from: data)
        let existing = try context.fetch(FetchDescriptor<Recipe>())
        let existingKeys = Set(existing.map(RecipeDTO.init))

        var summary = Summary()
        for dto in document.recipes {
            guard !existingKeys.contains(dto) else {
                summary.skipped += 1
                continue
            }
            let recipe = Recipe(
                title: dto.title,
                ingredients: dto.ingredients.map { context.ingredient(named: $0) }
            )
            if let bookTitle = dto.book {
                recipe.book = context.book(titled: bookTitle)
                recipe.page = dto.page
            }
            recipe.instructionsMarkdown = dto.instructionsMarkdown
            context.insert(recipe)
            summary.imported += 1
        }
        return summary
    }
}
