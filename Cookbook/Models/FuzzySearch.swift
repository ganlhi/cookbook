import Foundation

/// Recherche floue par sous-séquence, insensible à la casse et aux accents.
enum FuzzySearch {
    /// Score de correspondance de `query` dans `candidate`, ou nil si tous les
    /// caractères de la requête ne se retrouvent pas dans l'ordre.
    /// Plus le score est élevé, meilleure est la correspondance.
    static func score(query: String, in candidate: String) -> Int? {
        let query = Array(normalize(query))
        let candidate = Array(normalize(candidate))
        guard !query.isEmpty else { return 0 }

        var score = 0
        var queryIndex = 0
        var previousMatched = false

        for (index, char) in candidate.enumerated() {
            guard queryIndex < query.count else { break }
            if char == query[queryIndex] {
                let isWordStart = index == 0 || candidate[index - 1] == " "
                if isWordStart {
                    score += 3
                } else if previousMatched {
                    score += 2
                } else {
                    score += 1
                }
                previousMatched = true
                queryIndex += 1
            } else {
                previousMatched = false
            }
        }

        guard queryIndex == query.count else { return nil }
        // Bonus pour les correspondances compactes par rapport au titre complet.
        return score + max(0, 10 - (candidate.count - query.count) / 4)
    }

    static func normalize(_ string: String) -> String {
        string
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: nil)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
