import SwiftUI

/// Rendu Markdown par blocs (titres, listes, paragraphes), sans dépendance externe.
/// Les styles inline (gras, italique, code) sont gérés par AttributedString.
struct MarkdownView: View {
    let markdown: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(blocks) { block in
                blockView(block)
            }
        }
    }

    private struct Block: Identifiable {
        enum Kind {
            case heading(level: Int)
            case listItem(marker: String)
            case paragraph
        }

        let id: Int
        let kind: Kind
        let text: String
    }

    private var blocks: [Block] {
        var result: [Block] = []
        var paragraphBuffer: [String] = []

        func flushParagraph() {
            guard !paragraphBuffer.isEmpty else { return }
            result.append(Block(id: result.count, kind: .paragraph, text: paragraphBuffer.joined(separator: " ")))
            paragraphBuffer = []
        }

        for rawLine in markdown.components(separatedBy: .newlines) {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.isEmpty {
                flushParagraph()
            } else if let heading = parseHeading(line) {
                flushParagraph()
                result.append(Block(id: result.count, kind: .heading(level: heading.level), text: heading.text))
            } else if let item = parseListItem(line) {
                flushParagraph()
                result.append(Block(id: result.count, kind: .listItem(marker: item.marker), text: item.text))
            } else {
                paragraphBuffer.append(line)
            }
        }
        flushParagraph()
        return result
    }

    private func parseHeading(_ line: String) -> (level: Int, text: String)? {
        let hashes = line.prefix(while: { $0 == "#" })
        guard (1...4).contains(hashes.count) else { return nil }
        let text = line.dropFirst(hashes.count).trimmingCharacters(in: .whitespaces)
        guard !text.isEmpty else { return nil }
        return (hashes.count, text)
    }

    private func parseListItem(_ line: String) -> (marker: String, text: String)? {
        if line.hasPrefix("- ") || line.hasPrefix("* ") {
            return ("•", String(line.dropFirst(2)).trimmingCharacters(in: .whitespaces))
        }
        // Liste ordonnée : « 1. texte » ou « 1) texte »
        let digits = line.prefix(while: \.isNumber)
        guard !digits.isEmpty else { return nil }
        let rest = line.dropFirst(digits.count)
        guard rest.hasPrefix(". ") || rest.hasPrefix(") ") else { return nil }
        return ("\(digits).", String(rest.dropFirst(2)).trimmingCharacters(in: .whitespaces))
    }

    @ViewBuilder
    private func blockView(_ block: Block) -> some View {
        switch block.kind {
        case .heading(let level):
            inlineText(block.text)
                .font(headingFont(level))
                .padding(.top, level <= 2 ? 8 : 4)
        case .listItem(let marker):
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(marker)
                    .foregroundStyle(.secondary)
                inlineText(block.text)
            }
            .padding(.leading, 4)
        case .paragraph:
            inlineText(block.text)
        }
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title.weight(.bold)
        case 2: .title2.weight(.semibold)
        case 3: .title3.weight(.semibold)
        default: .headline
        }
    }

    private func inlineText(_ text: String) -> Text {
        if let attributed = try? AttributedString(
            markdown: text,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        ) {
            Text(attributed)
        } else {
            Text(verbatim: text)
        }
    }
}

#Preview {
    ScrollView {
        MarkdownView(markdown: """
        # Tarte aux pommes

        Une recette **simple** et *rapide*.

        ## Ingrédients

        - 3 pommes
        - 1 pâte brisée

        ## Étapes

        1. Préchauffer le four à 180°C
        2. Étaler la pâte
        3. Disposer les pommes et enfourner 35 min
        """)
        .padding()
    }
}
