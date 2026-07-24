#include "search_ranking.hpp"

#include <algorithm>
#include <cctype>

namespace ranking {

namespace {

// Weights for each searchable field; their sum is the theoretical max score
// for a single query token that matches exactly everywhere.
constexpr double kNameWeight = 5.0;
constexpr double kCompanyWeight = 3.0;
constexpr double kDescriptionWeight = 2.0;
constexpr double kTotalFieldWeight = kNameWeight + kCompanyWeight + kDescriptionWeight;

constexpr double kFuzzyThreshold = 0.6;   // below this similarity, treat as unrelated
constexpr double kSubstringScore = 0.7;   // token appears inside/around a word
constexpr double kFuzzyScoreCap = 0.5;    // fuzzy matches never outrank a real substring hit

std::string to_lower_ascii(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (unsigned char c : s) {
        out += (c < 128) ? static_cast<char>(std::tolower(c)) : static_cast<char>(c);
    }
    return out;
}

bool is_word_byte(unsigned char c) {
    return std::isalnum(c) || c >= 0x80;  // >=0x80: UTF-8 continuation/lead byte
}

size_t levenshtein(const std::string& a, const std::string& b) {
    const size_t n = a.size();
    const size_t m = b.size();
    std::vector<size_t> prev(m + 1);
    std::vector<size_t> curr(m + 1);
    for (size_t j = 0; j <= m; ++j) prev[j] = j;

    for (size_t i = 1; i <= n; ++i) {
        curr[0] = i;
        for (size_t j = 1; j <= m; ++j) {
            size_t cost = (a[i - 1] == b[j - 1]) ? 0 : 1;
            curr[j] = std::min({prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost});
        }
        std::swap(prev, curr);
    }
    return prev[m];
}

double similarity(const std::string& a, const std::string& b) {
    if (a.empty() || b.empty()) return 0.0;
    size_t dist = levenshtein(a, b);
    size_t max_len = std::max(a.size(), b.size());
    return 1.0 - static_cast<double>(dist) / static_cast<double>(max_len);
}

// How well a single query token matches a single field, as a 0..1 ratio.
double token_field_ratio(const std::string& field_lower,
                          const std::vector<std::string>& field_words,
                          const std::string& token) {
    if (std::find(field_words.begin(), field_words.end(), token) != field_words.end()) {
        return 1.0;
    }
    if (field_lower.find(token) != std::string::npos) {
        return kSubstringScore;
    }
    double best = 0.0;
    for (const auto& word : field_words) {
        best = std::max(best, similarity(word, token));
    }
    return best >= kFuzzyThreshold ? best * kFuzzyScoreCap : 0.0;
}

}  // namespace

std::vector<std::string> tokenize(const std::string& text) {
    std::string lower = to_lower_ascii(text);
    std::vector<std::string> tokens;
    std::string current;
    for (unsigned char c : lower) {
        if (is_word_byte(c)) {
            current += static_cast<char>(c);
        } else if (!current.empty()) {
            tokens.push_back(current);
            current.clear();
        }
    }
    if (!current.empty()) tokens.push_back(current);
    return tokens;
}

double relevance_score(const Internship& item, const std::vector<std::string>& query_tokens) {
    if (query_tokens.empty()) return 0.0;

    struct Field {
        std::string lower;
        std::vector<std::string> words;
        double weight;
    };

    std::string name_lower = to_lower_ascii(item.name);
    std::string company_lower = to_lower_ascii(item.company);
    std::string description_lower = to_lower_ascii(item.description);

    std::vector<Field> fields = {
        {name_lower, tokenize(name_lower), kNameWeight},
        {company_lower, tokenize(company_lower), kCompanyWeight},
        {description_lower, tokenize(description_lower), kDescriptionWeight},
    };

    double total = 0.0;
    for (const auto& token : query_tokens) {
        for (const auto& field : fields) {
            total += field.weight * token_field_ratio(field.lower, field.words, token);
        }
    }

    double avg_per_token = total / static_cast<double>(query_tokens.size());
    return avg_per_token / kTotalFieldWeight;
}

}  // namespace ranking
