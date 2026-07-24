#pragma once

#include <string>
#include <vector>

#include "internship.hpp"

// A small rule-based tag taxonomy: each tag fires when any of its trigger
// keywords appears (case-insensitively, as a substring) in a posting's name,
// company, or description. This is intentionally plain keyword matching, not
// a classifier — no training data, no ML dependency — and it exists to make
// *why* a posting is categorized a certain way legible, and to let the
// frontend show/group by field later. Expect it to need occasional tuning as
// new postings introduce vocabulary the dictionary doesn't cover yet.
namespace tagging {

// Tags that apply to `item`, in taxonomy order. A posting can have several,
// or none if nothing in the dictionary matched.
std::vector<std::string> tags_for(const Internship& item);

}  // namespace tagging
