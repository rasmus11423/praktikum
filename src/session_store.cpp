#include "session_store.hpp"

#include <iomanip>
#include <random>
#include <sstream>

namespace {

std::string random_token() {
    std::random_device rd;
    std::uniform_int_distribution<int> dist(0, 255);
    std::ostringstream out;
    out << std::hex << std::setfill('0');
    for (int i = 0; i < 32; ++i) out << std::setw(2) << dist(rd);
    return out.str();
}

}  // namespace

std::string SessionStore::create_session(const std::string& user_id) {
    std::string token = random_token();
    std::lock_guard<std::mutex> lock(mutex_);
    token_to_user_id_[token] = user_id;
    return token;
}

std::optional<std::string> SessionStore::user_id_for(const std::string& token) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = token_to_user_id_.find(token);
    if (it == token_to_user_id_.end()) return std::nullopt;
    return it->second;
}

void SessionStore::destroy_session(const std::string& token) {
    std::lock_guard<std::mutex> lock(mutex_);
    token_to_user_id_.erase(token);
}
