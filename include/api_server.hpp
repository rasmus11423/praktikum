#pragma once

#include <string>

#include "internship_store.hpp"
#include "session_store.hpp"
#include "user_store.hpp"

class ApiServer {
public:
    ApiServer(InternshipStore& store, UserStore& users, std::string public_dir);

    // Blocks, serving HTTP on the given port. Returns false if the server
    // failed to bind.
    bool listen(const std::string& host, int port);

private:
    InternshipStore& store_;
    UserStore& users_;
    SessionStore sessions_;  // in-memory; see session_store.hpp for why
    std::string public_dir_;
};
