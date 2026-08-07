#include "api_server.hpp"

#include <algorithm>
#include <map>
#include <string>
#include <vector>

#include <httplib.h>
#include <nlohmann/json.hpp>

#include "search_ranking.hpp"

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

    if (req.has_param("location")) {
        std::string raw = req.get_param_value("location");
        std::string lower_raw = to_lower(raw);
        auto locations = store.distinct_locations();
        auto match = std::find_if(locations.begin(), locations.end(), [&](const std::string& l) {
            return to_lower(l) == lower_raw;
        });
        if (match == locations.end()) {
            error = "Invalid 'location' value: must be one of " + join(locations, ", ");
            return std::nullopt;
        }
        filters.location = *match;
    }

    if (req.has_param("tags")) {
        auto known = store.distinct_tags();
        std::vector<std::string> requested;
        for (size_t i = 0; i < req.get_param_value_count("tags"); ++i) {
            requested.push_back(req.get_param_value("tags", i));
        }
        std::vector<std::string> resolved;
        for (const auto& raw : requested) {
            std::string lower_raw = to_lower(raw);
            auto match = std::find_if(known.begin(), known.end(), [&](const std::string& t) {
                return to_lower(t) == lower_raw;
            });
            if (match == known.end()) {
                error = "Invalid 'tags' value: '" + raw + "' — must be one of " + join(known, ", ");
                return std::nullopt;
            }
            resolved.push_back(*match);
        }
        filters.tags = resolved;
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

// Same as postings_to_json, but also attaches a "relevance" score (0..1) per
// item when a keyword query was given, so the frontend can render closeness
// as layers instead of a flat list. `relevance` is `null` when there's no `q`.
json search_results_to_json(const std::vector<Internship>& items,
                             const std::optional<std::string>& q) {
    std::optional<std::vector<std::string>> query_tokens;
    if (q) query_tokens = ranking::tokenize(*q);

    json arr = json::array();
    for (const auto& item : items) {
        json j = item.to_json();
        j["relevance"] = query_tokens ? json(ranking::relevance_score(item, *query_tokens))
                                       : json(nullptr);
        arr.push_back(std::move(j));
    }
    return arr;
}

// Counts how many of the given postings carry each tag, sorted by count
// descending (most common category first) then alphabetically.
json tag_facet_counts(const std::vector<Internship>& items) {
    std::map<std::string, int> counts;
    for (const auto& item : items) {
        for (const auto& tag : item.tags) counts[tag]++;
    }

    std::vector<std::pair<std::string, int>> sorted(counts.begin(), counts.end());
    std::sort(sorted.begin(), sorted.end(), [](const auto& a, const auto& b) {
        return a.second != b.second ? a.second > b.second : a.first < b.first;
    });

    json arr = json::array();
    for (const auto& [tag, count] : sorted) {
        arr.push_back({{"tag", tag}, {"count", count}});
    }
    return arr;
}

std::optional<std::string> get_cookie(const httplib::Request& req, const std::string& name) {
    std::string header = req.get_header_value("Cookie");
    size_t pos = 0;
    while (pos <= header.size()) {
        size_t semi = header.find(';', pos);
        std::string part =
            header.substr(pos, semi == std::string::npos ? std::string::npos : semi - pos);
        size_t eq = part.find('=');
        if (eq != std::string::npos) {
            if (trim(part.substr(0, eq)) == name) return trim(part.substr(eq + 1));
        }
        if (semi == std::string::npos) break;
        pos = semi + 1;
    }
    return std::nullopt;
}

// Not marked Secure since this runs over plain HTTP for local dev; add
// Secure (and serve over HTTPS) before any real deployment.
void set_session_cookie(httplib::Response& res, const std::string& token) {
    res.set_header("Set-Cookie",
                    "session=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800");
}

void clear_session_cookie(httplib::Response& res) {
    res.set_header("Set-Cookie", "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

std::optional<json> parse_json_body(const httplib::Request& req, std::string& error) {
    if (req.body.empty()) {
        error = "Missing request body";
        return std::nullopt;
    }
    try {
        return json::parse(req.body);
    } catch (const std::exception&) {
        error = "Invalid JSON body";
        return std::nullopt;
    }
}

json public_user_to_json(const PublicUser& user) {
    return json{{"id", user.id}, {"email", user.email}, {"created_at", user.created_at}};
}

json saved_search_to_json(const SavedSearch& s) {
    return json{{"id", s.id}, {"name", s.name}, {"query", s.query}, {"created_at", s.created_at}};
}

// Reads the session cookie and resolves it to a user id, sending a 401
// itself and returning nullopt if there's no valid session — every /api/me/*
// handler starts with `auto user_id = require_user(...); if (!user_id) return;`.
std::optional<std::string> require_user(const httplib::Request& req, httplib::Response& res,
                                         const SessionStore& sessions) {
    auto token = get_cookie(req, "session");
    auto user_id = token ? sessions.user_id_for(*token) : std::nullopt;
    if (!user_id) {
        send_error(res, 401, "Not logged in");
        return std::nullopt;
    }
    return user_id;
}

}  // namespace

ApiServer::ApiServer(InternshipStore& store, UserStore& users, std::string public_dir)
    : store_(store), users_(users), public_dir_(std::move(public_dir)) {}

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
        res.set_content(search_results_to_json(store_.search(*filters), filters->q).dump(),
                        "application/json");
    });

    svr.Get("/api/facets", [this](const httplib::Request& req, httplib::Response& res) {
        std::string error;
        auto filters = parse_filters(req, store_, error);
        if (!filters) {
            send_error(res, 400, error);
            return;
        }
        // Facets always answer "what tags are available given the other
        // active filters?" — so an already-selected `tags` filter doesn't
        // shrink its own facet list to just what's currently checked.
        filters->tags = std::nullopt;
        json body = {{"tags", tag_facet_counts(store_.search(*filters))}};
        res.set_content(body.dump(), "application/json");
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

    svr.Post("/api/auth/register", [this](const httplib::Request& req, httplib::Response& res) {
        std::string error;
        auto body = parse_json_body(req, error);
        if (!body) {
            send_error(res, 400, error);
            return;
        }
        std::string reg_error;
        auto user_id = users_.register_user(body->value("email", ""), body->value("password", ""),
                                             reg_error);
        if (!user_id) {
            send_error(res, 400, reg_error);
            return;
        }
        set_session_cookie(res, sessions_.create_session(*user_id));
        res.status = 201;
        res.set_content(public_user_to_json(*users_.get_public_user(*user_id)).dump(),
                        "application/json");
    });

    svr.Post("/api/auth/login", [this](const httplib::Request& req, httplib::Response& res) {
        std::string error;
        auto body = parse_json_body(req, error);
        if (!body) {
            send_error(res, 400, error);
            return;
        }
        auto user_id = users_.verify_login(body->value("email", ""), body->value("password", ""));
        if (!user_id) {
            send_error(res, 401, "Invalid email or password");
            return;
        }
        set_session_cookie(res, sessions_.create_session(*user_id));
        res.set_content(public_user_to_json(*users_.get_public_user(*user_id)).dump(),
                        "application/json");
    });

    svr.Post("/api/auth/logout", [this](const httplib::Request& req, httplib::Response& res) {
        auto token = get_cookie(req, "session");
        if (token) sessions_.destroy_session(*token);
        clear_session_cookie(res);
        res.status = 204;
    });

    svr.Get("/api/auth/me", [this](const httplib::Request& req, httplib::Response& res) {
        auto user_id = require_user(req, res, sessions_);
        if (!user_id) return;
        auto pub = users_.get_public_user(*user_id);
        if (!pub) {
            send_error(res, 401, "Not logged in");
            return;
        }
        res.set_content(public_user_to_json(*pub).dump(), "application/json");
    });

    svr.Get("/api/me/favorites", [this](const httplib::Request& req, httplib::Response& res) {
        auto user_id = require_user(req, res, sessions_);
        if (!user_id) return;
        json arr = json::array();
        for (const auto& id : users_.list_favorite_ids(*user_id)) {
            if (auto item = store_.find_by_id(id)) arr.push_back(item->to_json());
        }
        res.set_content(arr.dump(), "application/json");
    });

    svr.Post("/api/me/favorites", [this](const httplib::Request& req, httplib::Response& res) {
        auto user_id = require_user(req, res, sessions_);
        if (!user_id) return;
        std::string error;
        auto body = parse_json_body(req, error);
        if (!body) {
            send_error(res, 400, error);
            return;
        }
        std::string internship_id = body->value("internship_id", "");
        if (!store_.find_by_id(internship_id)) {
            send_error(res, 404, "No internship found with id '" + internship_id + "'");
            return;
        }
        users_.add_favorite(*user_id, internship_id);
        res.status = 204;
    });

    svr.Delete(R"(/api/me/favorites/([^/]+))",
               [this](const httplib::Request& req, httplib::Response& res) {
                   auto user_id = require_user(req, res, sessions_);
                   if (!user_id) return;
                   users_.remove_favorite(*user_id, req.matches[1]);
                   res.status = 204;
               });

    svr.Get("/api/me/searches", [this](const httplib::Request& req, httplib::Response& res) {
        auto user_id = require_user(req, res, sessions_);
        if (!user_id) return;
        json arr = json::array();
        for (const auto& s : users_.list_saved_searches(*user_id)) {
            arr.push_back(saved_search_to_json(s));
        }
        res.set_content(arr.dump(), "application/json");
    });

    svr.Post("/api/me/searches", [this](const httplib::Request& req, httplib::Response& res) {
        auto user_id = require_user(req, res, sessions_);
        if (!user_id) return;
        std::string error;
        auto body = parse_json_body(req, error);
        if (!body) {
            send_error(res, 400, error);
            return;
        }
        std::string name = trim(body->value("name", ""));
        if (name.empty()) {
            send_error(res, 400, "Saved search needs a name");
            return;
        }
        auto id = users_.add_saved_search(*user_id, name, body->value("query", ""));
        res.status = 201;
        res.set_content(json{{"id", *id}}.dump(), "application/json");
    });

    svr.Delete(R"(/api/me/searches/([^/]+))",
               [this](const httplib::Request& req, httplib::Response& res) {
                   auto user_id = require_user(req, res, sessions_);
                   if (!user_id) return;
                   users_.delete_saved_search(*user_id, req.matches[1]);
                   res.status = 204;
               });

    svr.Get("/api/me/history", [this](const httplib::Request& req, httplib::Response& res) {
        auto user_id = require_user(req, res, sessions_);
        if (!user_id) return;
        json arr = json::array();
        for (const auto& v : users_.list_recently_viewed(*user_id)) {
            auto item = store_.find_by_id(v.internship_id);
            if (!item) continue;
            json j = item->to_json();
            j["viewed_at"] = v.viewed_at;
            arr.push_back(std::move(j));
        }
        res.set_content(arr.dump(), "application/json");
    });

    svr.Post("/api/me/history", [this](const httplib::Request& req, httplib::Response& res) {
        auto user_id = require_user(req, res, sessions_);
        if (!user_id) return;
        std::string error;
        auto body = parse_json_body(req, error);
        if (!body) {
            send_error(res, 400, error);
            return;
        }
        std::string internship_id = body->value("internship_id", "");
        if (!store_.find_by_id(internship_id)) {
            send_error(res, 404, "No internship found with id '" + internship_id + "'");
            return;
        }
        users_.record_view(*user_id, internship_id);
        res.status = 204;
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
