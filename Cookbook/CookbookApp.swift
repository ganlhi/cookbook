import SwiftUI
import SwiftData

@main
struct CookbookApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .modelContainer(for: [Recipe.self, Ingredient.self, Book.self])
    }
}
