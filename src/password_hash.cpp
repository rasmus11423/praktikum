#include "password_hash.hpp"

#include <cstdint>
#include <iomanip>
#include <random>
#include <sstream>
#include <vector>

#include <picosha2.h>

namespace password_hash {

namespace {

using Bytes = std::vector<unsigned char>;

constexpr size_t kBlockSize = 64;  // SHA-256 block size
constexpr size_t kSaltSize = 16;
constexpr int kIterations = 120000;  // see the benchmark note in password_hash.hpp

Bytes sha256(const Bytes& msg) {
    Bytes out(picosha2::k_digest_size);
    picosha2::hash256(msg.begin(), msg.end(), out.begin(), out.end());
    return out;
}

Bytes hmac_sha256(Bytes key, const Bytes& msg) {
    if (key.size() > kBlockSize) key = sha256(key);
    key.resize(kBlockSize, 0);

    Bytes o_key_pad(kBlockSize), i_key_pad(kBlockSize);
    for (size_t i = 0; i < kBlockSize; ++i) {
        o_key_pad[i] = key[i] ^ 0x5c;
        i_key_pad[i] = key[i] ^ 0x36;
    }

    Bytes inner = i_key_pad;
    inner.insert(inner.end(), msg.begin(), msg.end());
    Bytes inner_hash = sha256(inner);

    Bytes outer = o_key_pad;
    outer.insert(outer.end(), inner_hash.begin(), inner_hash.end());
    return sha256(outer);
}

// dklen == hlen (32 bytes) for our use, so PBKDF2 only ever needs the first
// output block (i=1) — no need for the general multi-block DK concatenation.
Bytes pbkdf2_sha256(const std::string& password, const Bytes& salt, int iterations) {
    Bytes pw(password.begin(), password.end());
    Bytes salt_block = salt;
    salt_block.push_back(0);
    salt_block.push_back(0);
    salt_block.push_back(0);
    salt_block.push_back(1);  // INT_32_BE(1)

    Bytes u = hmac_sha256(pw, salt_block);  // U1
    Bytes result = u;
    for (int i = 1; i < iterations; ++i) {
        u = hmac_sha256(pw, u);  // U_{i+1} = HMAC(P, U_i)
        for (size_t j = 0; j < result.size(); ++j) result[j] ^= u[j];
    }
    return result;
}

std::string to_hex(const Bytes& bytes) {
    std::ostringstream out;
    out << std::hex << std::setfill('0');
    for (unsigned char b : bytes) out << std::setw(2) << static_cast<int>(b);
    return out.str();
}

Bytes from_hex(const std::string& hex) {
    Bytes out;
    out.reserve(hex.size() / 2);
    for (size_t i = 0; i + 1 < hex.size(); i += 2) {
        out.push_back(static_cast<unsigned char>(std::stoi(hex.substr(i, 2), nullptr, 16)));
    }
    return out;
}

Bytes random_bytes(size_t count) {
    std::random_device rd;
    std::uniform_int_distribution<int> dist(0, 255);
    Bytes bytes(count);
    for (auto& b : bytes) b = static_cast<unsigned char>(dist(rd));
    return bytes;
}

// Avoids leaking timing info about *where* a mismatch occurs.
bool constant_time_equal(const Bytes& a, const Bytes& b) {
    if (a.size() != b.size()) return false;
    unsigned char diff = 0;
    for (size_t i = 0; i < a.size(); ++i) diff |= (a[i] ^ b[i]);
    return diff == 0;
}

}  // namespace

Hashed hash_password(const std::string& password) {
    Bytes salt = random_bytes(kSaltSize);
    Bytes derived = pbkdf2_sha256(password, salt, kIterations);
    return Hashed{to_hex(salt), to_hex(derived), kIterations};
}

bool verify_password(const std::string& password, const std::string& salt_hex,
                      const std::string& hash_hex, int iterations) {
    Bytes salt = from_hex(salt_hex);
    Bytes expected = from_hex(hash_hex);
    Bytes actual = pbkdf2_sha256(password, salt, iterations);
    return constant_time_equal(actual, expected);
}

}  // namespace password_hash
