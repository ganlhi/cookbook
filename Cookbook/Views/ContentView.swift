import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(\.modelContext) private var modelContext
    @Query(sort: \Recipe.createdAt, order: .reverse) private var recipes: [Recipe]
    @Query(sort: \Ingredient.name) private var allIngredients: [Ingredient]

    @State private var showingAddSheet = false
    @State private var searchText = ""
    @State private var selectedIngredients: Set<String> = []

    @State private var isSelecting = false
    @State private var selection: Set<PersistentIdentifier> = []
    @State private var showingImporter = false
    @State private var importMessage: String?

    var body: some View {
        NavigationStack {
            List(selection: $selection) {
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
            .environment(\.editMode, .constant(isSelecting ? .active : .inactive))
            .navigationDestination(for: Recipe.self) { recipe in
                RecipeDetailView(recipe: recipe)
            }
            .navigationTitle("Recettes")
            .searchable(text: $searchText, prompt: "Rechercher une recette")
            .toolbar { toolbarContent }
            .sheet(isPresented: $showingAddSheet) {
                RecipeFormView()
            }
            .fileImporter(
                isPresented: $showingImporter,
                allowedContentTypes: [.json]
            ) { result in
                handleImport(result)
            }
            .alert(
                "Import",
                isPresented: Binding(
                    get: { importMessage != nil },
                    set: { if !$0 { importMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(importMessage ?? "")
            }
        }
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        if isSelecting {
            ToolbarItem(placement: .cancellationAction) {
                Button("Terminé") {
                    isSelecting = false
                    selection = []
                }
            }
            ToolbarItem(placement: .primaryAction) {
                ShareLink(
                    item: CookbookExport(recipes: selectedRecipeDTOs),
                    preview: SharePreview("Recettes sélectionnées")
                ) {
                    Label("Exporter la sélection (\(selection.count))", systemImage: "square.and.arrow.up")
                }
                .disabled(selection.isEmpty)
            }
        } else {
            ToolbarItem(placement: .secondaryAction) {
                ShareLink(
                    item: CookbookExport(recipes: recipes.map(RecipeDTO.init)),
                    preview: SharePreview("Toutes les recettes")
                ) {
                    Label("Tout exporter", systemImage: "square.and.arrow.up")
                }
                .disabled(recipes.isEmpty)
            }
            ToolbarItem(placement: .secondaryAction) {
                Button {
                    isSelecting = true
                } label: {
                    Label("Sélectionner…", systemImage: "checkmark.circle")
                }
                .disabled(recipes.isEmpty)
            }
            ToolbarItem(placement: .secondaryAction) {
                Button {
                    showingImporter = true
                } label: {
                    Label("Importer…", systemImage: "square.and.arrow.down")
                }
            }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showingAddSheet = true
                } label: {
                    Label("Ajouter", systemImage: "plus")
                }
            }
        }
    }

    // MARK: - Export / import

    private var selectedRecipeDTOs: [RecipeDTO] {
        recipes.filter { selection.contains($0.id) }.map(RecipeDTO.init)
    }

    private func handleImport(_ result: Result<URL, Error>) {
        do {
            let url = try result.get()
            guard url.startAccessingSecurityScopedResource() else {
                importMessage = "Impossible d'accéder au fichier."
                return
            }
            defer { url.stopAccessingSecurityScopedResource() }
            let data = try Data(contentsOf: url)
            let summary = try RecipeImporter.importData(data, into: modelContext)
            importMessage = "\(summary.imported) recette(s) importée(s), \(summary.skipped) ignorée(s) (déjà présentes)."
        } catch {
            importMessage = "Échec de l'import : \(error.localizedDescription)"
        }
    }

    // MARK: - Filtrage

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
