#pragma once

#include <mutex>
#include <optional>
#include <string>
#include <vector>

struct SavedSearch {
    std::string id;
    std::string name;
    std::string query;  // raw query string, e.g. "q=tarkvara&location=Tallinn"
    std::string created_at;
};

struct RecentlyViewedEntry {
    std::string internship_id;
    std::string viewed_at;
};

struct PublicUser {
    std::string id;
    std::string email;
    std::string created_at;
};

// JSON-file-backed user accounts: registration/login, favorites, saved
// search presets, and a recently-viewed history. Deliberately not a real
// database — a single mutex-guarded file, rewritten whole on every mutation.
// Fine at this scale (a handful of users, infrequent writes); would need a
// real database (the "SQL part" we're deliberately deferring) to scale
// further or to get safer concurrent-write semantics.
class UserStore {
public:
    explicit UserStore(std::string path);

    // Loads existing accounts from disk. Safe to call when the file doesn't
    // exist yet (e.g. first run) — starts empty in that case.
    void load();

    // Registers a new account. Returns the new user's id, or nullopt with
    // `error` set to a human-readable reason (duplicate email, too-short
    // password, malformed email).
    std::optional<std::string> register_user(const std::string& email,
                                              const std::string& password,
                                              std::string& error);

    // Returns the user id if email/password match an account, else nullopt.
    std::optional<std::string> verify_login(const std::string& email,
                                             const std::string& password) const;

    std::optional<PublicUser> get_public_user(const std::string& user_id) const;

    bool add_favorite(const std::string& user_id, const std::string& internship_id);
    bool remove_favorite(const std::string& user_id, const std::string& internship_id);
    std::vector<std::string> list_favorite_ids(const std::string& user_id) const;

    // Returns the new preset's id, or nullopt if user_id doesn't exist.
    std::optional<std::string> add_saved_search(const std::string& user_id,
                                                 const std::string& name,
                                                 const std::string& query);
    bool delete_saved_search(const std::string& user_id, const std::string& search_id);
    std::vector<SavedSearch> list_saved_searches(const std::string& user_id) const;

    // Records a view, moving it to the front if already present; capped at
    // the 20 most recent.
    void record_view(const std::string& user_id, const std::string& internship_id);
    std::vector<RecentlyViewedEntry> list_recently_viewed(const std::string& user_id) const;

private:
    struct Account {
        std::string id;
        std::string email;
        std::string password_hash;
        std::string password_salt;
        int password_iterations = 0;
        std::string created_at;
        std::vector<std::string> favorites;
        std::vector<SavedSearch> saved_searches;
        std::vector<RecentlyViewedEntry> recently_viewed;
    };

    Account* find_account(const std::string& user_id);
    const Account* find_account(const std::string& user_id) const;
    void save_locked() const;

    mutable std::mutex mutex_;
    std::string path_;
    std::vector<Account> accounts_;
    int next_id_ = 1;
};
