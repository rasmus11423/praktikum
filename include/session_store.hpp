#pragma once

#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>

// Maps opaque session tokens (set as a cookie) to user ids. Deliberately
// in-memory only, unlike UserStore — losing sessions on a server restart
// just means logging in again, not losing data, so there's no need to
// persist this to disk.
class SessionStore {
public:
    // Generates a new random token for `user_id` and returns it.
    std::string create_session(const std::string& user_id);

    std::optional<std::string> user_id_for(const std::string& token) const;

    void destroy_session(const std::string& token);

private:
    mutable std::mutex mutex_;
    std::unordered_map<std::string, std::string> token_to_user_id_;
};
