#include <cstdlib>
#include <iostream>
#include <string>

#include "api_server.hpp"
#include "internship_store.hpp"

namespace {

std::string env_or(const char* name, const std::string& fallback) {
    const char* value = std::getenv(name);
    return value ? std::string(value) : fallback;
}

// Very small argv parser for --key value pairs; falls back to env vars,
// then hardcoded defaults. Lets the same binary run from a repo checkout
// (paths relative to CWD) or from a container (paths passed explicitly).
struct Options {
    std::string host = "0.0.0.0";
    int port = 8080;
    std::string data_path = "data/internships.csv";
    std::string public_dir = "public";
};

Options parse_options(int argc, char** argv) {
    Options opts;
    opts.host = env_or("HOST", opts.host);
    opts.port = std::stoi(env_or("PORT", std::to_string(opts.port)));
    opts.data_path = env_or("INTERNSHIP_DATA_PATH", opts.data_path);
    opts.public_dir = env_or("INTERNSHIP_PUBLIC_DIR", opts.public_dir);

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        auto next = [&]() -> std::string {
            if (i + 1 >= argc) {
                throw std::runtime_error("Missing value for argument: " + arg);
            }
            return argv[++i];
        };
        if (arg == "--host") opts.host = next();
        else if (arg == "--port") opts.port = std::stoi(next());
        else if (arg == "--data") opts.data_path = next();
        else if (arg == "--public") opts.public_dir = next();
        else {
            throw std::runtime_error("Unknown argument: " + arg);
        }
    }
    return opts;
}

}  // namespace

int main(int argc, char** argv) {
    Options opts;
    try {
        opts = parse_options(argc, argv);
    } catch (const std::exception& e) {
        std::cerr << "Argument error: " << e.what() << "\n";
        return 1;
    }

    InternshipStore store;
    try {
        store.load_from_file(opts.data_path);
    } catch (const DataLoadError& e) {
        std::cerr << "Failed to load internship data: " << e.what() << "\n";
        return 1;
    } catch (const std::exception& e) {
        std::cerr << "Failed to parse internship data: " << e.what() << "\n";
        return 1;
    }

    std::cout << "Loaded " << store.all().size() << " internship postings from "
              << opts.data_path << "\n";

    ApiServer server(store, opts.public_dir);
    std::cout << "Serving on http://" << opts.host << ":" << opts.port
              << " (static: " << opts.public_dir << ")\n";

    if (!server.listen(opts.host, opts.port)) {
        std::cerr << "Failed to bind to " << opts.host << ":" << opts.port << "\n";
        return 1;
    }

    return 0;
}
