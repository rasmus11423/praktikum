#pragma once

#include <optional>
#include <string>
#include <vector>

#include "internship.hpp"

struct SearchFilters {
    std::optional<std::string> q;                  // keyword, matched case-insensitively
    std::optional<bool> paid;                       // exact match on paid flag
    std::optional<std::string> employment_type;      // exact match, case-insensitive
    std::optional<std::string> deadline_before;      // ISO date, inclusive upper bound
    std::optional<std::string> deadline_after;        // ISO date, inclusive lower bound
};

// Thrown when the CSV file at the given path is missing or unreadable.
class DataLoadError : public std::runtime_error {
public:
    explicit DataLoadError(const std::string& what) : std::runtime_error(what) {}
};

class InternshipStore {
public:
    // Loads and replaces all postings from the given CSV file.
    // Throws DataLoadError if the file cannot be opened, or std::runtime_error
    // if the header row doesn't match the expected schema.
    void load_from_file(const std::string& path);

    const std::vector<Internship>& all() const { return items_; }

    std::optional<Internship> find_by_id(const std::string& id) const;

    std::vector<Internship> search(const SearchFilters& filters) const;

private:
    std::vector<Internship> items_;
};

// Validates an ISO date string (YYYY-MM-DD, with plausible month/day ranges).
bool is_valid_iso_date(const std::string& date);
