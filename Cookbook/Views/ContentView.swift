import SwiftUI
import SwiftData

struct ContentView: View {
    @Query(sort: \Recipe.createdAt, order: .reverse) private var recipes: [Recipe]
    @State private var showingAddSheet = false

    var body: some View {
        NavigationStack {
            List(recipes) { recipe in
                NavigationLink(value: recipe) {
                    RecipeRowView(recipe: recipe)
                }
            }
            .navigationDestination(for: Recipe.self) { recipe in
                RecipeDetailView(recipe: recipe)
            }
            .navigationTitle("Recettes")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingAddSheet = true
                    } label: {
                        Label("Ajouter", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $showingAddSheet) {
                RecipeFormView()
            }
        }
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [Recipe.self, Ingredient.self, Book.self], inMemory: true)
}
