import SwiftUI
import SwiftData

struct RecipeDetailView: View {
    let recipe: Recipe

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if !recipe.ingredients.isEmpty {
                    ingredientsSection
                }

                if let book = recipe.book {
                    bookSection(book)
                }

                if let markdown = recipe.instructionsMarkdown {
                    MarkdownView(markdown: markdown)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .navigationTitle(recipe.title)
        .navigationBarTitleDisplayMode(.large)
    }

    private var ingredientsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Ingrédients principaux")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            FlowingChips(items: recipe.ingredients.map(\.name).sorted())
        }
    }

    private func bookSection(_ book: Book) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "book.closed.fill")
                .font(.title2)
                .foregroundStyle(Color.accentColor)
            VStack(alignment: .leading, spacing: 2) {
                Text(book.title)
                    .font(.headline)
                if let page = recipe.page {
                    Text("Page \(page)")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding()
        .background(Color.accentColor.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Chips d'ingrédients qui passent à la ligne.
struct FlowingChips: View {
    let items: [String]

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(items, id: \.self) { item in
                Text(item)
                    .font(.callout)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.quaternary, in: Capsule())
            }
        }
    }
}

/// Layout en lignes qui replie les éléments trop larges.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(proposal: proposal, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let arrangement = arrange(proposal: proposal, subviews: subviews)
        for (subview, position) in zip(subviews, arrangement.positions) {
            subview.place(
                at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y),
                proposal: .unspecified
            )
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            totalWidth = max(totalWidth, x - spacing)
        }
        return (CGSize(width: totalWidth, height: y + rowHeight), positions)
    }
}
