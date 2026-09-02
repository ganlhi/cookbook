import SwiftUI

struct RecipeRowView: View {
    let recipe: Recipe

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: recipe.kind == .bookReference ? "book.closed" : "list.bullet.rectangle")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(recipe.title)
                    .font(.headline)
            }
            if let book = recipe.book {
                Text(recipe.page.map { "\(book.title), p. \($0)" } ?? book.title)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if !recipe.ingredients.isEmpty {
                Text(recipe.ingredients.map(\.name).sorted().joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }
}
