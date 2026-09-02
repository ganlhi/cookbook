import SwiftUI
import SwiftData

struct ContentView: View {
    @Query(sort: \Recipe.createdAt, order: .reverse) private var recipes: [Recipe]
    @Query(sort: \Ingredient.name) private var allIngredients: [Ingredient]

    @State private var showingAddSheet = false
    @State private var searchText = ""
    @State private var selectedIngredients: Set<String> = []

    var body: some View {
        NavigationStack {
            List {
                if !usedIngredients.isEmpty {
                    Section {
                        ingredientFilterChips
                            .listRowInsets(EdgeInsets(top: 8, leading: 12, bottom: 8, trailing: 12))
                            .listRowBackground(Color.clear)
                    }
                }

                Section {
                    ForEach(filteredRecipes) { recipe in
                        NavigationLink(value: recipe) {
                            RecipeRowView(recipe: recipe)
                        }
                    }
                }
            }
            .navigationDestination(for: Recipe.self) { recipe in
                RecipeDetailView(recipe: recipe)
            }
            .navigationTitle("Recettes")
            .searchable(text: $searchText, prompt: "Rechercher une recette")
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

    /// Ingrédients réellement utilisés par au moins une recette.
    private var usedIngredients: [Ingredient] {
        allIngredients.filter { !$0.recipes.isEmpty }
    }

    private var filteredRecipes: [Recipe] {
        var result = recipes

        if !selectedIngredients.isEmpty {
            result = result.filter { recipe in
                let names = Set(recipe.ingredients.map(\.name))
                return selectedIngredients.isSubset(of: names)
            }
        }

        let query = searchText.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return result }

        return result
            .compactMap { recipe in
                FuzzySearch.score(query: query, in: recipe.title).map { (recipe, $0) }
            }
            .sorted { $0.1 > $1.1 }
            .map(\.0)
    }

    private var ingredientFilterChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(usedIngredients) { ingredient in
                    let isSelected = selectedIngredients.contains(ingredient.name)
                    Button {
                        if isSelected {
                            selectedIngredients.remove(ingredient.name)
                        } else {
                            selectedIngredients.insert(ingredient.name)
                        }
                    } label: {
                        Text(ingredient.name)
                            .font(.callout)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(
                                isSelected ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.quaternary),
                                in: Capsule()
                            )
                            .foregroundStyle(isSelected ? .white : .primary)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

#Preview {
    ContentView()
        .modelContainer(for: [Recipe.self, Ingredient.self, Book.self], inMemory: true)
}
