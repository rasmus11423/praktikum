#pragma once

#include <string>
#include <vector>

#include "internship.hpp"

// Scores how closely a posting matches a free-text query, instead of just
// filtering postings in/out. Combines, per query word: exact whole-word
// matches, substring matches (catches Estonian noun declensions like
// "praktika" inside "praktikant"), and edit-distance ("fuzzy") matches for
// typos or near-variants — weighted by which field it appears in
// (name > company > description). Nothing here understands meaning or
// synonyms; "closeness" is purely lexical.
namespace ranking {

// Lowercases (ASCII only) and splits into word tokens. Multi-byte UTF-8
// sequences (e.g. õ/ä/ö/ü) are kept intact as part of a word rather than
// being split apart, since every continuation/lead byte has its high bit set.
std::vector<std::string> tokenize(const std::string& text);

// Relevance of `item` to an already-tokenized query, roughly bounded to
// [0, 1]: 1.0 means every query token matched exactly in every field.
// Returns 0 for an empty token list or a posting with no lexical overlap.
double relevance_score(const Internship& item, const std::vector<std::string>& query_tokens);

}  // namespace ranking
