#pragma once

#include <string>

#include <nlohmann/json.hpp>

struct Internship {
    std::string id;
    std::string name;
    std::string company;
    std::string description;
    bool paid = false;
    std::string pay;
    std::string employment_type;
    std::string deadline; // ISO date, YYYY-MM-DD

    nlohmann::json to_json() const {
        return nlohmann::json{
            {"id", id},
            {"name", name},
            {"company", company},
            {"description", description},
            {"paid", paid},
            {"pay", pay},
            {"employment_type", employment_type},
            {"deadline", deadline},
        };
    }
};
