import SwiftUI
import SwiftData

struct ContentView: View {
    @Query(sort: \Recipe.createdAt, order: .reverse) private var recipes: [Recipe]

    var body: some View {
        NavigationStack {
            List(recipes) { recipe in
                Text(recipe.title)
            }
            .navigationTitle("Recettes")
        }
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [Recipe.self, Ingredient.self, Book.self], inMemory: true)
}
