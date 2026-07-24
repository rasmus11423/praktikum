#pragma once

#include <string>

#include "internship_store.hpp"

class ApiServer {
public:
    ApiServer(InternshipStore& store, std::string public_dir);

    // Blocks, serving HTTP on the given port. Returns false if the server
    // failed to bind.
    bool listen(const std::string& host, int port);

private:
    InternshipStore& store_;
    std::string public_dir_;
};
