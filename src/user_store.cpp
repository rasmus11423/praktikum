#include "user_store.hpp"

#include <algorithm>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <random>
#include <sstream>

#include <nlohmann/json.hpp>

#include "internship.hpp"  // trim()
#include "password_hash.hpp"

namespace {

using json = nlohmann::json;

std::string now_iso8601() {
    std::time_t now = std::time(nullptr);
    std::tm utc{};
    gmtime_r(&now, &utc);
    char buf[21];
    std::strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &utc);
    return std::string(buf);
}

std::string to_lower(const std::string& s) {
    std::string out = s;
    std::transform(out.begin(), out.end(), out.begin(),
                    [](unsigned char c) { return std::tolower(c); });
    return out;
}

bool looks_like_email(const std::string& email) {
    auto at = email.find('@');
    return at != std::string::npos && at > 0 && at < email.size() - 1 &&
           email.find('.', at) != std::string::npos;
}

std::string random_hex_id(size_t bytes = 6) {
    std::random_device rd;
    std::uniform_int_distribution<int> dist(0, 255);
    std::ostringstream out;
    out << std::hex << std::setfill('0');
    for (size_t i = 0; i < bytes; ++i) out << std::setw(2) << dist(rd);
    return out.str();
}

}  // namespace

UserStore::UserStore(std::string path) : path_(std::move(path)) {}

void UserStore::load() {
    std::lock_guard<std::mutex> lock(mutex_);
    std::ifstream file(path_);
    if (!file.is_open()) return;  // first run — start empty, save() creates it later

    json root;
    file >> root;

    next_id_ = root.value("next_id", 1);
    accounts_.clear();
    for (const auto& u : root.value("users", json::array())) {
        Account account;
        account.id = u.value("id", "");
        account.email = u.value("email", "");
        account.password_hash = u.value("password_hash", "");
        account.password_salt = u.value("password_salt", "");
        account.password_iterations = u.value("password_iterations", 0);
        account.created_at = u.value("created_at", "");
        account.favorites = u.value("favorites", std::vector<std::string>{});
        for (const auto& s : u.value("saved_searches", json::array())) {
            account.saved_searches.push_back(SavedSearch{
                s.value("id", ""), s.value("name", ""), s.value("query", ""),
                s.value("created_at", "")});
        }
        for (const auto& v : u.value("recently_viewed", json::array())) {
            account.recently_viewed.push_back(RecentlyViewedEntry{
                v.value("internship_id", ""), v.value("viewed_at", "")});
        }
        accounts_.push_back(std::move(account));
    }
}

void UserStore::save_locked() const {
    std::filesystem::path p(path_);
    if (p.has_parent_path()) {
        std::filesystem::create_directories(p.parent_path());
    }

    json root;
    root["next_id"] = next_id_;
    json users = json::array();
    for (const auto& a : accounts_) {
        json searches = json::array();
        for (const auto& s : a.saved_searches) {
            searches.push_back({{"id", s.id},
                                 {"name", s.name},
                                 {"query", s.query},
                                 {"created_at", s.created_at}});
        }
        json viewed = json::array();
        for (const auto& v : a.recently_viewed) {
            viewed.push_back({{"internship_id", v.internship_id}, {"viewed_at", v.viewed_at}});
        }
        users.push_back({
            {"id", a.id},
            {"email", a.email},
            {"password_hash", a.password_hash},
            {"password_salt", a.password_salt},
            {"password_iterations", a.password_iterations},
            {"created_at", a.created_at},
            {"favorites", a.favorites},
            {"saved_searches", searches},
            {"recently_viewed", viewed},
        });
    }
    root["users"] = users;

    std::ofstream file(path_);
    file << root.dump(2);
}

UserStore::Account* UserStore::find_account(const std::string& user_id) {
    auto it = std::find_if(accounts_.begin(), accounts_.end(),
                            [&](const Account& a) { return a.id == user_id; });
    return it == accounts_.end() ? nullptr : &*it;
}

const UserStore::Account* UserStore::find_account(const std::string& user_id) const {
    auto it = std::find_if(accounts_.begin(), accounts_.end(),
                            [&](const Account& a) { return a.id == user_id; });
    return it == accounts_.end() ? nullptr : &*it;
}

std::optional<std::string> UserStore::register_user(const std::string& email,
                                                      const std::string& password,
                                                      std::string& error) {
    std::string trimmed_email = trim(email);
    if (!looks_like_email(trimmed_email)) {
        error = "Invalid email address";
        return std::nullopt;
    }
    if (password.size() < 8) {
        error = "Password must be at least 8 characters";
        return std::nullopt;
    }

    // Hashing is CPU-bound and touches no shared state, so do it before
    // taking the lock — it's ~100ms+ and would otherwise block every other
    // request against this store for that long.
    auto hashed = password_hash::hash_password(password);

    std::lock_guard<std::mutex> lock(mutex_);
    std::string lower = to_lower(trimmed_email);
    bool exists = std::any_of(accounts_.begin(), accounts_.end(), [&](const Account& a) {
        return to_lower(a.email) == lower;
    });
    if (exists) {
        error = "An account with this email already exists";
        return std::nullopt;
    }

    Account account;
    account.id = std::to_string(next_id_++);
    account.email = trimmed_email;
    account.password_hash = hashed.hash_hex;
    account.password_salt = hashed.salt_hex;
    account.password_iterations = hashed.iterations;
    account.created_at = now_iso8601();
    accounts_.push_back(account);
    save_locked();
    return account.id;
}

std::optional<std::string> UserStore::verify_login(const std::string& email,
                                                     const std::string& password) const {
    std::string lower = to_lower(trim(email));

    // Copy out just what's needed and release the lock before the ~100ms+
    // hash verification, same reasoning as register_user.
    std::string user_id, salt, hash;
    int iterations = 0;
    bool found = false;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        for (const auto& a : accounts_) {
            if (to_lower(a.email) != lower) continue;
            user_id = a.id;
            salt = a.password_salt;
            hash = a.password_hash;
            iterations = a.password_iterations;
            found = true;
            break;
        }
    }
    if (!found) {
        // Still pay the hashing cost so response timing doesn't reveal
        // whether the email exists (cheap mitigation for user enumeration).
        static const password_hash::Hashed dummy =
            password_hash::hash_password("dummy-password-for-constant-time-login");
        password_hash::verify_password(password, dummy.salt_hex, dummy.hash_hex,
                                        dummy.iterations);
        return std::nullopt;
    }
    if (password_hash::verify_password(password, salt, hash, iterations)) {
        return user_id;
    }
    return std::nullopt;
}

std::optional<PublicUser> UserStore::get_public_user(const std::string& user_id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    const Account* a = find_account(user_id);
    if (!a) return std::nullopt;
    return PublicUser{a->id, a->email, a->created_at};
}

bool UserStore::add_favorite(const std::string& user_id, const std::string& internship_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    Account* a = find_account(user_id);
    if (!a) return false;
    if (std::find(a->favorites.begin(), a->favorites.end(), internship_id) ==
        a->favorites.end()) {
        a->favorites.push_back(internship_id);
        save_locked();
    }
    return true;
}

bool UserStore::remove_favorite(const std::string& user_id, const std::string& internship_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    Account* a = find_account(user_id);
    if (!a) return false;
    auto it = std::find(a->favorites.begin(), a->favorites.end(), internship_id);
    if (it != a->favorites.end()) {
        a->favorites.erase(it);
        save_locked();
    }
    return true;
}

std::vector<std::string> UserStore::list_favorite_ids(const std::string& user_id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    const Account* a = find_account(user_id);
    return a ? a->favorites : std::vector<std::string>{};
}

std::optional<std::string> UserStore::add_saved_search(const std::string& user_id,
                                                         const std::string& name,
                                                         const std::string& query) {
    std::lock_guard<std::mutex> lock(mutex_);
    Account* a = find_account(user_id);
    if (!a) return std::nullopt;
    SavedSearch s{random_hex_id(), trim(name), query, now_iso8601()};
    a->saved_searches.push_back(s);
    save_locked();
    return s.id;
}

bool UserStore::delete_saved_search(const std::string& user_id, const std::string& search_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    Account* a = find_account(user_id);
    if (!a) return false;
    auto it = std::find_if(a->saved_searches.begin(), a->saved_searches.end(),
                            [&](const SavedSearch& s) { return s.id == search_id; });
    if (it == a->saved_searches.end()) return false;
    a->saved_searches.erase(it);
    save_locked();
    return true;
}

std::vector<SavedSearch> UserStore::list_saved_searches(const std::string& user_id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    const Account* a = find_account(user_id);
    return a ? a->saved_searches : std::vector<SavedSearch>{};
}

void UserStore::record_view(const std::string& user_id, const std::string& internship_id) {
    constexpr size_t kMaxHistory = 20;
    std::lock_guard<std::mutex> lock(mutex_);
    Account* a = find_account(user_id);
    if (!a) return;

    auto it = std::find_if(a->recently_viewed.begin(), a->recently_viewed.end(),
                            [&](const RecentlyViewedEntry& v) {
                                return v.internship_id == internship_id;
                            });
    if (it != a->recently_viewed.end()) a->recently_viewed.erase(it);

    a->recently_viewed.insert(a->recently_viewed.begin(),
                               RecentlyViewedEntry{internship_id, now_iso8601()});
    if (a->recently_viewed.size() > kMaxHistory) {
        a->recently_viewed.resize(kMaxHistory);
    }
    save_locked();
}

std::vector<RecentlyViewedEntry> UserStore::list_recently_viewed(
    const std::string& user_id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    const Account* a = find_account(user_id);
    return a ? a->recently_viewed : std::vector<RecentlyViewedEntry>{};
}
