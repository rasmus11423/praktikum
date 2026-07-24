#pragma once

#include <string>

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

struct Internship {
    std::string id;
    std::string name;
    std::string company;
    std::string description;
    std::string pay;              // free-text compensation info, e.g. "1000-1500 €/kuus (bruto)"
    std::string employment_type;  // e.g. "täiskoormusega", "tähtajaline"
    std::string deadline;         // ISO date, YYYY-MM-DD
    std::string link;             // URL to the original posting

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
            {"link", link},
        };
    }
};
