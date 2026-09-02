import SwiftUI
import SwiftData

struct RecipeFormView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    /// Recette à modifier ; nil pour une création.
    let recipeToEdit: Recipe?

    init(recipe: Recipe? = nil) {
        recipeToEdit = recipe
    }

    enum FormKind: String, CaseIterable, Identifiable {
        case bookReference
        case fullRecipe

        var id: String { rawValue }

        var label: String {
            switch self {
            case .bookReference: "Référence livre"
            case .fullRecipe: "Recette complète"
            }
        }
    }

    @Query(sort: \Ingredient.name) private var allIngredients: [Ingredient]
    @Query(sort: \Book.title) private var allBooks: [Book]

    @State private var kind: FormKind = .bookReference
    @State private var title = ""
    @State private var ingredientNames: [String] = []
    @State private var ingredientInput = ""
    @State private var bookTitle = ""
    @State private var pageText = ""
    @State private var instructionsMarkdown = ""
    @State private var didLoad = false

    var body: some View {
        NavigationStack {
            Form {
                Picker("Type", selection: $kind) {
                    ForEach(FormKind.allCases) { kind in
                        Text(kind.label).tag(kind)
                    }
                }
                .pickerStyle(.segmented)
                .listRowBackground(Color.clear)

                Section("Titre") {
                    TextField("Titre de la recette", text: $title)
                }

                Section("Ingrédients principaux") {
                    ForEach(ingredientNames, id: \.self) { name in
                        Text(name)
                    }
                    .onDelete { ingredientNames.remove(atOffsets: $0) }

                    HStack {
                        TextField("Ajouter un ingrédient", text: $ingredientInput)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.never)
                            .onSubmit(addIngredient)
                        Button(action: addIngredient) {
                            Image(systemName: "plus.circle.fill")
                        }
                        .disabled(ingredientInput.trimmingCharacters(in: .whitespaces).isEmpty)
                    }

                    if !ingredientSuggestions.isEmpty {
                        SuggestionChipsView(suggestions: ingredientSuggestions) { name in
                            ingredientNames.append(name)
                            ingredientInput = ""
                        }
                    }
                }

                switch kind {
                case .bookReference:
                    Section("Livre") {
                        TextField("Titre du livre", text: $bookTitle)
                        if !bookSuggestions.isEmpty {
                            SuggestionChipsView(suggestions: bookSuggestions) { title in
                                bookTitle = title
                            }
                        }
                        TextField("Page", text: $pageText)
                            .keyboardType(.numberPad)
                    }
                case .fullRecipe:
                    Section("Instructions (Markdown)") {
                        TextEditor(text: $instructionsMarkdown)
                            .frame(minHeight: 180)
                            .autocorrectionDisabled()
                    }
                }
            }
            .navigationTitle(recipeToEdit == nil ? "Nouvelle recette" : "Modifier la recette")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annuler") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer", action: save)
                        .disabled(!isValid)
                }
            }
            .onAppear(perform: loadRecipe)
        }
    }

    private func loadRecipe() {
        guard !didLoad, let recipe = recipeToEdit else { return }
        didLoad = true
        title = recipe.title
        ingredientNames = recipe.ingredients.map(\.name).sorted()
        if let book = recipe.book {
            kind = .bookReference
            bookTitle = book.title
            pageText = recipe.page.map(String.init) ?? ""
        } else {
            kind = .fullRecipe
            instructionsMarkdown = recipe.instructionsMarkdown ?? ""
        }
    }

    private var ingredientSuggestions: [String] {
        let input = Ingredient.normalized(ingredientInput)
        return allIngredients
            .map(\.name)
            .filter { name in
                !ingredientNames.contains(name)
                    && (input.isEmpty || name.localizedStandardContains(input))
                    && name != input
            }
            .prefix(8)
            .map { $0 }
    }

    private var bookSuggestions: [String] {
        let input = bookTitle.trimmingCharacters(in: .whitespaces)
        return allBooks
            .map(\.title)
            .filter { title in
                (input.isEmpty || title.localizedStandardContains(input)) && title != input
            }
            .prefix(8)
            .map { $0 }
    }

    private var isValid: Bool {
        let hasTitle = !title.trimmingCharacters(in: .whitespaces).isEmpty
        switch kind {
        case .bookReference:
            return hasTitle && !bookTitle.trimmingCharacters(in: .whitespaces).isEmpty
        case .fullRecipe:
            return hasTitle && !instructionsMarkdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    private func addIngredient() {
        let name = Ingredient.normalized(ingredientInput)
        guard !name.isEmpty, !ingredientNames.contains(name) else {
            ingredientInput = ""
            return
        }
        ingredientNames.append(name)
        ingredientInput = ""
    }

    private func save() {
        // Un ingrédient encore dans le champ de saisie ne doit pas être perdu.
        addIngredient()

        let recipe = recipeToEdit ?? Recipe(title: "")
        recipe.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        recipe.ingredients = ingredientNames.map { modelContext.ingredient(named: $0) }

        switch kind {
        case .bookReference:
            recipe.book = modelContext.book(titled: bookTitle)
            recipe.page = Int(pageText.trimmingCharacters(in: .whitespaces))
            recipe.instructionsMarkdown = nil
        case .fullRecipe:
            recipe.book = nil
            recipe.page = nil
            recipe.instructionsMarkdown = instructionsMarkdown
        }

        if recipeToEdit == nil {
            modelContext.insert(recipe)
        }
        modelContext.cleanupOrphans()
        dismiss()
    }
}

#Preview {
    RecipeFormView()
        .modelContainer(for: [Recipe.self, Ingredient.self, Book.self], inMemory: true)
}
