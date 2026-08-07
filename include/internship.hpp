#pragma once

#include <cctype>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

// Sentinel text the CSV uses when compensation isn't listed for a posting.
inline const std::string kPayNotSpecified = "Pole märgitud";

inline std::string trim(const std::string& s) {
    size_t start = s.find_first_not_of(" \t\r\n");
    if (start == std::string::npos) return "";
    size_t end = s.find_last_not_of(" \t\r\n");
    return s.substr(start, end - start + 1);
}

// True when the posting actually lists a pay amount/range, as opposed to the
// CSV's "Pole märgitud" (not specified) placeholder or an empty field.
inline bool is_pay_specified(const std::string& pay) {
    std::string trimmed = trim(pay);
    return !trimmed.empty() && trimmed != kPayNotSpecified;
}

// Validates an ISO date string (YYYY-MM-DD, with plausible month/day ranges).
inline bool is_valid_iso_date(const std::string& date) {
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

// The CSV sometimes uses free text like "Pidev" (ongoing/rolling admission)
// in the deadline column instead of a fixed date. Anything that isn't a
// valid ISO date is treated as "no fixed deadline" — never expires, and
// can't be meaningfully compared against a deadline_before/after range.
inline bool is_rolling_deadline(const std::string& deadline) {
    return !is_valid_iso_date(deadline);
}

struct Internship {
    std::string id;
    std::string name;
    std::string company;
    std::string description;
    std::string pay;              // free-text compensation info, e.g. "1000-1500 €/kuus (bruto)"
    std::string employment_type;  // e.g. "täiskoormusega", "tähtajaline"
    std::string deadline;         // ISO date, YYYY-MM-DD, or free text like "Pidev" (rolling)
    std::string link;             // URL to the original posting
    std::string location;         // free-text location, e.g. "Tallinn", "Kaugtöö", "Läti / Kaugtöö"
    std::string source;           // portal the posting was found on, e.g. "career.taltech.ee"
    std::vector<std::string> keywords;  // curated Estonian-English keyword phrases from the CSV
    std::vector<std::string> tags;      // computed at load time, see tagging.hpp

    nlohmann::json to_json() const {
        return nlohmann::json{
            {"id", id},
            {"name", name},
            {"company", company},
            {"description", description},
            {"pay", pay},
            {"pay_specified", is_pay_specified(pay)},
            {"employment_type", employment_type},
            {"deadline", deadline},
            {"deadline_rolling", is_rolling_deadline(deadline)},
            {"link", link},
            {"location", location},
            {"source", source},
            {"keywords", keywords},
            {"tags", tags},
        };
    }
};
