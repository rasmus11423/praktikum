#include "csv_parser.hpp"

#include <sstream>

namespace csv {

std::vector<std::vector<std::string>> parse(std::istream& input) {
    std::vector<std::vector<std::string>> rows;
    std::vector<std::string> row;
    std::string field;
    bool in_quotes = false;
    bool row_has_content = false;

    char c;
    while (input.get(c)) {
        if (in_quotes) {
            if (c == '"') {
                if (input.peek() == '"') {
                    input.get(c);
                    field += '"';
                } else {
                    in_quotes = false;
                }
            } else {
                field += c;
            }
            continue;
        }

        switch (c) {
            case '"':
                in_quotes = true;
                row_has_content = true;
                break;
            case ',':
                row.push_back(field);
                field.clear();
                row_has_content = true;
                break;
            case '\r':
                break;  // ignore, handle newline on \n
            case '\n':
                if (row_has_content || !field.empty() || !row.empty()) {
                    row.push_back(field);
                    rows.push_back(row);
                    row.clear();
                    field.clear();
                    row_has_content = false;
                }
                break;
            default:
                field += c;
                row_has_content = true;
                break;
        }
    }

    // Flush trailing field/row if the file didn't end with a newline.
    if (row_has_content || !field.empty() || !row.empty()) {
        row.push_back(field);
        rows.push_back(row);
    }

    return rows;
}

std::vector<std::vector<std::string>> parse_string(const std::string& text) {
    std::istringstream stream(text);
    return parse(stream);
}

}  // namespace csv
