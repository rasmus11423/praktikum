#include "internship_store.hpp"

#include <algorithm>
#include <cctype>
#include <ctime>
#include <fstream>
#include <stdexcept>
#include <unordered_map>

#include "csv_parser.hpp"
#include "search_ranking.hpp"
#include "tagging.hpp"

namespace {

std::string to_lower(const std::string& s) {
    std::string out = s;
    std::transform(out.begin(), out.end(), out.begin(),
                    [](unsigned char c) { return std::tolower(c); });
    return out;
}

std::vector<std::string> expected_header() {
    return {"id", "nimi", "ettevõte", "kirjeldus", "tasu", "tööaeg",
            "tähtaeg", "link", "asukoht", "leitud_portaalist", "keywords"};
}

// Splits the "keywords" column ("term-term; term-term; ...") into individual
// phrases. Each phrase is kept as-is (e.g. "tarkvaraarendus-software
// engineering") rather than split further into Estonian/English halves —
// several entries are ambiguous to split (e.g. "front-end-front-end",
// "IT-õigus-IT law"), and keeping the whole phrase works fine for search
// anyway since tokenizing already treats the internal "-" as a separator.
std::vector<std::string> split_keywords(const std::string& raw) {
    std::vector<std::string> parts;
    size_t start = 0;
    while (start <= raw.size()) {
        size_t end = raw.find(';', start);
        if (end == std::string::npos) end = raw.size();
        std::string piece = trim(raw.substr(start, end - start));
        if (!piece.empty()) parts.push_back(piece);
        start = end + 1;
    }
    return parts;
}

std::string today_iso_date() {
    std::time_t now = std::time(nullptr);
    std::tm local{};
    localtime_r(&now, &local);
    char buf[11];
    std::strftime(buf, sizeof(buf), "%Y-%m-%d", &local);
    return std::string(buf);
}

}  // namespace

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
            "kirjeldus,tasu,tööaeg,tähtaeg,link,asukoht,leitud_portaalist,"
            "keywords): " + path);
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
        item.location = row[8];
        item.source = row[9];
        item.keywords = split_keywords(row[10]);
        item.tags = tagging::tags_for(item);
        loaded.push_back(std::move(item));
    }

    items_ = std::move(loaded);
}

std::vector<Internship> InternshipStore::active_items() const {
    std::string today = today_iso_date();
    std::vector<Internship> active;
    for (const auto& item : items_) {
        if (is_rolling_deadline(item.deadline) || item.deadline >= today) {
            active.push_back(item);
        }
    }
    return active;
}

std::vector<Internship> InternshipStore::all() const { return active_items(); }

std::optional<Internship> InternshipStore::find_by_id(const std::string& id) const {
    auto active = active_items();
    auto it = std::find_if(active.begin(), active.end(),
                            [&](const Internship& i) { return i.id == id; });
    if (it == active.end()) return std::nullopt;
    return *it;
}

std::vector<Internship> InternshipStore::search(const SearchFilters& filters) const {
    std::vector<Internship> results;
    for (const auto& item : active_items()) {
        // Note: `q` is intentionally not a hard filter here — it only ranks
        // results (see below). Everything else stays an exact include/exclude.
        if (filters.pay_specified && is_pay_specified(item.pay) != *filters.pay_specified) {
            continue;
        }
        if (filters.employment_type &&
            to_lower(item.employment_type) != to_lower(*filters.employment_type)) {
            continue;
        }
        if (filters.location &&
            to_lower(item.location) != to_lower(*filters.location)) {
            continue;
        }
        if ((filters.deadline_after || filters.deadline_before) &&
            is_rolling_deadline(item.deadline)) {
            // A rolling ("Pidev") deadline has no date to compare against a
            // requested range, so it can't satisfy a deadline filter.
            continue;
        }
        if (filters.deadline_after && item.deadline < *filters.deadline_after) {
            continue;
        }
        if (filters.deadline_before && item.deadline > *filters.deadline_before) {
            continue;
        }
        if (filters.tags && !filters.tags->empty()) {
            bool has_any = std::any_of(filters.tags->begin(), filters.tags->end(),
                                       [&](const std::string& tag) {
                                           return std::find(item.tags.begin(), item.tags.end(),
                                                             tag) != item.tags.end();
                                       });
            if (!has_any) continue;
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
    for (const auto& item : active_items()) {
        if (std::find(types.begin(), types.end(), item.employment_type) == types.end()) {
            types.push_back(item.employment_type);
        }
    }
    std::sort(types.begin(), types.end());
    return types;
}

std::vector<std::string> InternshipStore::distinct_locations() const {
    std::vector<std::string> locations;
    for (const auto& item : active_items()) {
        if (std::find(locations.begin(), locations.end(), item.location) == locations.end()) {
            locations.push_back(item.location);
        }
    }
    std::sort(locations.begin(), locations.end());
    return locations;
}

std::vector<std::string> InternshipStore::distinct_tags() const {
    std::vector<std::string> tags;
    for (const auto& item : active_items()) {
        for (const auto& tag : item.tags) {
            if (std::find(tags.begin(), tags.end(), tag) == tags.end()) {
                tags.push_back(tag);
            }
        }
    }
    std::sort(tags.begin(), tags.end());
    return tags;
}
