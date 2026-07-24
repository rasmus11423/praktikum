#include "internship_store.hpp"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <stdexcept>
#include <unordered_map>

#include "csv_parser.hpp"
#include "search_ranking.hpp"

namespace {

std::string to_lower(const std::string& s) {
    std::string out = s;
    std::transform(out.begin(), out.end(), out.begin(),
                    [](unsigned char c) { return std::tolower(c); });
    return out;
}

std::vector<std::string> expected_header() {
    return {"id", "nimi", "ettevõte", "kirjeldus", "tasu",
            "tööaeg", "tähtaeg", "link"};
}

}  // namespace

bool is_valid_iso_date(const std::string& date) {
    if (date.size() != 10) return false;
    if (date[4] != '-' || date[7] != '-') return false;
    for (size_t i : {0, 1, 2, 3, 5, 6, 8, 9}) {
        if (!std::isdigit(static_cast<unsigned char>(date[i]))) return false;
    }
    int month = std::stoi(date.substr(5, 2));
    int day = std::stoi(date.substr(8, 2));
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    return true;
}

void InternshipStore::load_from_file(const std::string& path) {
    std::ifstream file(path);
    if (!file.is_open()) {
        throw DataLoadError("Could not open data file: " + path);
    }

    auto rows = csv::parse(file);
    if (rows.empty()) {
        throw std::runtime_error("Data file is empty: " + path);
    }

    const auto& header = rows.front();
    if (header != expected_header()) {
        throw std::runtime_error(
            "Data file has unexpected header (expected id,nimi,ettevõte,"
            "kirjeldus,tasu,tööaeg,tähtaeg,link): " + path);
    }

    std::vector<Internship> loaded;
    loaded.reserve(rows.size() - 1);

    for (size_t r = 1; r < rows.size(); ++r) {
        const auto& row = rows[r];
        if (row.size() == 1 && row[0].empty()) continue;  // trailing blank line
        if (row.size() != header.size()) {
            throw std::runtime_error(
                "Data file row " + std::to_string(r + 1) +
                " has wrong number of columns");
        }
        Internship item;
        item.id = row[0];
        item.name = row[1];
        item.company = row[2];
        item.description = row[3];
        item.pay = row[4];
        item.employment_type = row[5];
        item.deadline = row[6];
        item.link = row[7];
        loaded.push_back(std::move(item));
    }

    items_ = std::move(loaded);
}

std::optional<Internship> InternshipStore::find_by_id(const std::string& id) const {
    auto it = std::find_if(items_.begin(), items_.end(),
                            [&](const Internship& i) { return i.id == id; });
    if (it == items_.end()) return std::nullopt;
    return *it;
}

std::vector<Internship> InternshipStore::search(const SearchFilters& filters) const {
    std::vector<Internship> results;
    for (const auto& item : items_) {
        // Note: `q` is intentionally not a hard filter here — it only ranks
        // results (see below). Everything else stays an exact include/exclude.
        if (filters.pay_specified && is_pay_specified(item.pay) != *filters.pay_specified) {
            continue;
        }
        if (filters.employment_type &&
            to_lower(item.employment_type) != to_lower(*filters.employment_type)) {
            continue;
        }
        if (filters.deadline_after && item.deadline < *filters.deadline_after) {
            continue;
        }
        if (filters.deadline_before && item.deadline > *filters.deadline_before) {
            continue;
        }
        results.push_back(item);
    }

    if (filters.q) {
        auto query_tokens = ranking::tokenize(*filters.q);
        std::stable_sort(results.begin(), results.end(),
                          [&](const Internship& a, const Internship& b) {
                              return ranking::relevance_score(a, query_tokens) >
                                     ranking::relevance_score(b, query_tokens);
                          });
    }

    return results;
}

std::vector<std::string> InternshipStore::distinct_employment_types() const {
    std::vector<std::string> types;
    for (const auto& item : items_) {
        if (std::find(types.begin(), types.end(), item.employment_type) == types.end()) {
            types.push_back(item.employment_type);
        }
    }
    std::sort(types.begin(), types.end());
    return types;
}
