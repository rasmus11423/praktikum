cmake_minimum_required(VERSION 3.15)
project(internship_search_backend CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

include(FetchContent)

FetchContent_Declare(
  httplib
  GIT_REPOSITORY https://github.com/yhirose/cpp-httplib.git
  GIT_TAG v0.18.3
)

FetchContent_Declare(
  json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG v3.11.3
)

# Single-header SHA-256; used as the primitive underneath our own
# HMAC-SHA256/PBKDF2 password hashing (see src/password_hash.cpp). It has no
# CMakeLists.txt of its own, so it's only populated, not add_subdirectory'd.
FetchContent_Declare(
  picosha2
  GIT_REPOSITORY https://github.com/okdshin/PicoSHA2.git
  GIT_TAG master
)

set(HTTPLIB_REQUIRE_OPENSSL OFF CACHE BOOL "" FORCE)
set(HTTPLIB_REQUIRE_ZLIB OFF CACHE BOOL "" FORCE)
set(HTTPLIB_REQUIRE_BROTLI OFF CACHE BOOL "" FORCE)
set(JSON_BuildTests OFF CACHE INTERNAL "")

FetchContent_MakeAvailable(httplib json picosha2)

add_executable(internship_server
  src/main.cpp
  src/csv_parser.cpp
  src/search_ranking.cpp
  src/tagging.cpp
  src/internship_store.cpp
  src/password_hash.cpp
  src/session_store.cpp
  src/user_store.cpp
  src/api_server.cpp
)

target_include_directories(internship_server PRIVATE include ${picosha2_SOURCE_DIR})

target_link_libraries(internship_server PRIVATE httplib::httplib nlohmann_json::nlohmann_json)
