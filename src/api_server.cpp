#include "api_server.hpp"

#include <algorithm>
#include <string>
#include <vector>

#include <httplib.h>
#include <nlohmann/json.hpp>

namespace {

using json = nlohmann::json;

void send_error(httplib::Response& res, int status, const std::string& message) {
    res.status = status;
    res.set_content(json{{"error", message}}.dump(), "application/json");
}

std::string to_lower(const std::string& s) {
    std::string out = s;
    std::transform(out.begin(), out.end(), out.begin(),
                    [](unsigned char c) { return std::tolower(c); });
    return out;
}

std::string join(const std::vector<std::string>& values, const std::string& sep) {
    std::string out;
    for (size_t i = 0; i < values.size(); ++i) {
        if (i) out += sep;
        out += values[i];
    }
    return out;
}

// Parses and validates query params into a SearchFilters. On failure, sets
// `error` to a human-readable message and returns std::nullopt.
std::optional<SearchFilters> parse_filters(const httplib::Request& req,
                                            const InternshipStore& store,
                                            std::string& error) {
    SearchFilters filters;

    if (req.has_param("q")) {
        filters.q = req.get_param_value("q");
    }

    if (req.has_param("pay_specified")) {
        std::string lower = to_lower(req.get_param_value("pay_specified"));
        if (lower != "true" && lower != "false") {
            error = "Invalid 'pay_specified' value: must be 'true' or 'false'";
            return std::nullopt;
        }
        filters.pay_specified = (lower == "true");
    }

    if (req.has_param("type")) {
        std::string raw = req.get_param_value("type");
        std::string lower_raw = to_lower(raw);
        auto types = store.distinct_employment_types();
        auto match = std::find_if(types.begin(), types.end(), [&](const std::string& t) {
            return to_lower(t) == lower_raw;
        });
        if (match == types.end()) {
            error = "Invalid 'type' value: must be one of " + join(types, ", ");
            return std::nullopt;
        }
        filters.employment_type = *match;
    }

    if (req.has_param("deadline_before")) {
        std::string raw = req.get_param_value("deadline_before");
        if (!is_valid_iso_date(raw)) {
            error = "Invalid 'deadline_before' value: must be an ISO date (YYYY-MM-DD)";
            return std::nullopt;
        }
        filters.deadline_before = raw;
    }

    if (req.has_param("deadline_after")) {
        std::string raw = req.get_param_value("deadline_after");
        if (!is_valid_iso_date(raw)) {
            error = "Invalid 'deadline_after' value: must be an ISO date (YYYY-MM-DD)";
            return std::nullopt;
        }
        filters.deadline_after = raw;
    }

    return filters;
}

json postings_to_json(const std::vector<Internship>& items) {
    json arr = json::array();
    for (const auto& item : items) arr.push_back(item.to_json());
    return arr;
}

}  // namespace

ApiServer::ApiServer(InternshipStore& store, std::string public_dir)
    : store_(store), public_dir_(std::move(public_dir)) {}

bool ApiServer::listen(const std::string& host, int port) {
    httplib::Server svr;

    auto mount_result = svr.set_mount_point("/", public_dir_);
    if (!mount_result) {
        // Not fatal: API still works without the static frontend.
    }

    svr.Get("/api/internships", [this](const httplib::Request&, httplib::Response& res) {
        res.set_content(postings_to_json(store_.all()).dump(), "application/json");
    });

    svr.Get("/api/search", [this](const httplib::Request& req, httplib::Response& res) {
        std::string error;
        auto filters = parse_filters(req, store_, error);
        if (!filters) {
            send_error(res, 400, error);
            return;
        }
        res.set_content(postings_to_json(store_.search(*filters)).dump(), "application/json");
    });

    svr.Get(R"(/api/internships/([^/]+))", [this](const httplib::Request& req, httplib::Response& res) {
        std::string id = req.matches[1];
        auto item = store_.find_by_id(id);
        if (!item) {
            send_error(res, 404, "No internship found with id '" + id + "'");
            return;
        }
        res.set_content(item->to_json().dump(), "application/json");
    });

    svr.set_error_handler([](const httplib::Request&, httplib::Response& res) {
        if (res.body.empty()) {
            send_error(res, res.status, "Not found");
        }
    });

    svr.set_exception_handler([](const httplib::Request&, httplib::Response& res, std::exception_ptr ep) {
        std::string message = "Internal server error";
        try {
            if (ep) std::rethrow_exception(ep);
        } catch (const std::exception& e) {
            message = e.what();
        }
        send_error(res, 500, message);
    });

    return svr.listen(host, port);
}
