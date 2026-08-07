#pragma once

#include <string>

// PBKDF2-HMAC-SHA256 password hashing, built on the vendored picosha2
// SHA-256 primitive (no OpenSSL/libsodium dependency). This is a reasonable
// baseline for a prototype — salted, iterated, constant-time verification —
// but bcrypt/argon2 (memory-hard, purpose-built for passwords) would be the
// right upgrade before any real deployment.
namespace password_hash {

struct Hashed {
    std::string salt_hex;
    std::string hash_hex;
    int iterations;
};

// Generates a random salt and derives a hash from `password`.
Hashed hash_password(const std::string& password);

// Recomputes the hash with the stored salt/iterations and compares it to
// `hash_hex` in constant time.
bool verify_password(const std::string& password, const std::string& salt_hex,
                      const std::string& hash_hex, int iterations);

}  // namespace password_hash
