#include "tagging.hpp"

#include <cctype>

#include "search_ranking.hpp"

namespace tagging {

namespace {

std::string to_lower_ascii(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (unsigned char c : s) {
        out += (c < 128) ? static_cast<char>(std::tolower(c)) : static_cast<char>(c);
    }
    return out;
}

struct TagRule {
    std::string label;
    std::vector<std::string> keywords;
};

bool is_simple_word(const std::string& keyword) {
    if (keyword.empty()) return false;
    for (unsigned char c : keyword) {
        if (!(std::isalnum(c) || c >= 0x80)) return false;  // letters/digits/UTF-8 only
    }
    return true;
}

// Plain letter-keywords match against word tokens (equal, or a prefix of a
// longer inflected token) rather than a raw substring search. That matters:
// a raw substring search on "telekommunikatsiooniandmeid" would wrongly hit
// the keyword "kommunikatsioon" (marketing/comms), and "äriotsuste" would
// wrongly hit "iot" (IoT), purely because one word happens to contain the
// other's letters. Token-prefix matching avoids both. Keywords with spaces
// or symbols (phrases, "c++") aren't real word tokens, so those still fall
// back to a substring search over the raw text.
bool keyword_matches(const std::string& keyword, const std::string& haystack_lower,
                      const std::vector<std::string>& haystack_tokens) {
    if (!is_simple_word(keyword)) {
        return haystack_lower.find(keyword) != std::string::npos;
    }
    for (const auto& token : haystack_tokens) {
        if (token == keyword) return true;
        if (keyword.size() >= 4 && token.rfind(keyword, 0) == 0) return true;
    }
    return false;
}

// Keywords are written in the inflected forms that actually show up in
// Estonian text (e.g. "tarkvara", not the dictionary form) — matching is
// stem-prefix based, not full stemming/lemmatization.
const std::vector<TagRule>& rules() {
    static const std::vector<TagRule> kRules = {
        {"IT ja digilahendused", {"it", "digilahend", "infrastruktuur", "infosüsteem"}},
        {"Tarkvaraarendus", {"tarkvara", "arendaja", "programmeer", "c++", "python", "kood"}},
        {"Andmeteadus ja analüütika", {"andmet", "andmein", "andmeanal", "sql", "analüü"}},
        {"Pangandus ja rahandus", {"pank", "panga", "finants", "rahand", "eelarve", "palgaskaala"}},
        {"Turundus ja kommunikatsioon", {"turundus", "kommunikatsioon", "kampaania", "sisulooming", "sotsiaalmeedia"}},
        {"Personal ja HR", {"personal", "värbam", "hüvitis", "töötajakogemus", "people business"}},
        {"Disain ja kasutajakogemus", {"disain", "ux", "kasutajasõbral", "kujundus"}},
        {"Küberturvalisus", {"küberturv", "turvalisus", "turbe"}},
        {"Inseneeria ja riistvara", {"insener", "mehaanika", "riistvara", "tootmis", "lennund", "propulsioon", "ülikondensaat", "autocad", "cnc", "ehitus", "konstruktsioon"}},
        {"Robootika ja tehisintellekt", {"robo", "masinnägem", "masinõpe", "tehisintellekt", "iot", "asjade interne"}},
        {"Õigus", {"õigus", "jurist", "leping", "juriidil"}},
        {"Müük ja klienditeenindus", {"müügi", "müük", "klienditeenind"}},
        {"Logistika ja tarneahel", {"logistika", "tarneahel", "marsruu", "tarne"}},
        {"Riigisektor", {"riigiametnik", "riigiasutus", "maksu- ja tolliamet", "tolliamet", "ministeerium", "avalik sektor", "poliitika"}},
        {"Toote juhtimine", {"toote", "tootejuht"}},
        {"Võrk ja telekom", {"telekommunikatsioon", "võrgu", "mobiilsid", "andmesidevõrk"}},
        {"Hotellindus ja turism", {"hotellindus", "majutus", "toitlustus", "vastuvõtt", "turism", "spaa", "kokandus", "restoran"}},
        {"Põllumajandus ja aiandus", {"põllumajandus", "agronoomia", "aiandus", "taimekasvatus"}},
        {"Kunst ja kultuur", {"kunst", "kultuur", "galerii"}},
        {"Keskkond ja jätkusuutlikkus", {"keskkond", "jätkusuutlikkus"}},
    };
    return kRules;
}

}  // namespace

std::vector<std::string> tags_for(const Internship& item) {
    std::string keywords_blob;
    for (const auto& keyword : item.keywords) keywords_blob += keyword + " ";

    std::string haystack_lower = to_lower_ascii(
        item.name + " " + item.company + " " + item.description + " " + keywords_blob);
    auto tokens = ranking::tokenize(haystack_lower);

    std::vector<std::string> tags;
    for (const auto& rule : rules()) {
        for (const auto& keyword : rule.keywords) {
            if (keyword_matches(keyword, haystack_lower, tokens)) {
                tags.push_back(rule.label);
                break;
            }
        }
    }
    return tags;
}

}  // namespace tagging
