#pragma once

#include <istream>
#include <string>
#include <vector>

// Minimal RFC4180-ish CSV parser: handles quoted fields, embedded commas,
// embedded newlines inside quotes, and "" as an escaped quote.
namespace csv {

std::vector<std::vector<std::string>> parse(std::istream& input);
std::vector<std::vector<std::string>> parse_string(const std::string& text);

}  // namespace csv
