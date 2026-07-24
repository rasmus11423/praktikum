# Internship Search — Backend

A C++ HTTP server that loads internship postings from a CSV file and exposes
a search/filter JSON API, plus a minimal static test frontend served from the
same process. This is backend-focused scaffolding; the real frontend comes later.

## Project layout

```
/src        C++ source
/include    headers
/data       internships.csv (loaded at startup)
/public     minimal test frontend (html/css/js), served at "/"
/docker     Dockerfile, docker-compose.yml
CMakeLists.txt
```

## Tech stack

- C++17, built with CMake.
- [cpp-httplib](https://github.com/yhirose/cpp-httplib) for HTTP, fetched via CMake `FetchContent`.
- [nlohmann/json](https://github.com/nlohmann/json) for JSON, fetched via CMake `FetchContent`.
- A small hand-written CSV parser (`src/csv_parser.cpp`) — the schema is simple enough not to need a dependency.

No manual library installs are needed beyond CMake and a compiler — `FetchContent` downloads and builds cpp-httplib and nlohmann/json as part of the CMake configure/build step (requires network access the first time).

## Building & running on macOS

Prerequisites (via Homebrew):

```sh
brew install cmake
```

A C++ compiler is already available via Xcode Command Line Tools (`clang++`); install them with `xcode-select --install` if needed.

Build:

```sh
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
```

Run (from the repo root, so the default relative paths to `data/` and `public/` resolve):

```sh
./build/internship_server
```

By default it serves on `http://0.0.0.0:8080`. Override with flags or environment variables:

```sh
./build/internship_server --port 9090 --data data/internships.csv --public public
# or
PORT=9090 INTERNSHIP_DATA_PATH=data/internships.csv INTERNSHIP_PUBLIC_DIR=public ./build/internship_server
```

Then open `http://localhost:8080/` in a browser for the test frontend.

## Running with Docker

Multi-stage build: a Debian-based build stage compiles the app (fetching
dependencies via CMake), and a slim runtime stage just runs the binary and
serves `public/` + `data/`.

From the repo root:

```sh
docker compose -f docker/docker-compose.yml up --build
```

This exposes the server on `http://localhost:8080` by default. To use a different host port:

```sh
HOST_PORT=9090 docker compose -f docker/docker-compose.yml up --build
```

`data/` is mounted read-only into the container, so you can swap in a new CSV without rebuilding the image — just restart the container to pick up the change (data is loaded once at startup).

To build/run the image manually without compose:

```sh
docker build -f docker/Dockerfile -t internship-server .
docker run --rm -p 8080:8080 -v "$(pwd)/data:/app/data:ro" internship-server
```

## API

The data (and the test frontend) is in Estonian, but JSON keys stay in
English for a stable API contract — see the field list below.

### `GET /api/internships`
Returns all postings as a JSON array. Each item looks like:

```json
{
  "id": "1",
  "name": "Panganduspraktikant (Kick Start Your Career)",
  "company": "Swedbank Estonia",
  "description": "Rootsi päritolu suurpanga iga-aastane suvepraktika…",
  "pay": "1000-1500 €/kuus (bruto)",
  "pay_specified": true,
  "employment_type": "täiskoormusega",
  "deadline": "2026-04-30",
  "link": "https://www.swedbank.com/work-with-us/kick-start-your-career/et.html",
  "tags": ["Pangandus ja rahandus"]
}
```

`pay_specified` is derived server-side: `false` when `pay` is the CSV's
"Pole märgitud" (not specified) placeholder or empty, `true` otherwise. There's
no separate paid/unpaid boolean in the data — see `pay_specified` below.

### `GET /api/search`
Query params (all optional, combinable):

| param             | example        | notes                                              |
|-------------------|----------------|-----------------------------------------------------|
| `q`                | `q=panga` | **ranks, doesn't filter** — see "How `q` ranking works" below |
| `pay_specified`    | `pay_specified=true` | `true` or `false` — whether `pay` lists an actual amount vs. "Pole märgitud" |
| `type`             | `type=täiskoormusega`| must match one of the `employment_type` values actually present in the data (currently `täiskoormusega`, `tähtajaline`) — validated dynamically, not hardcoded |
| `tags`             | `tags=Pangandus%20ja%20rahandus` | repeatable (`tags=A&tags=B`); OR-matched (posting needs at least one), validated against tags actually present in the data — see "Tags" below |
| `deadline_after`   | `deadline_after=2026-09-01` | ISO date, inclusive lower bound        |
| `deadline_before`  | `deadline_before=2026-09-30`| ISO date, inclusive upper bound        |

Invalid values (e.g. `pay_specified=maybe`, an unknown `type`, a malformed date) return `400` with a JSON `{"error": "..."}` body — the `type` error message lists the currently valid values.

#### How `q` ranking works

Unlike the other params, `q` does **not** exclude non-matching postings — every
posting that passes the other filters is still returned, just sorted by how
closely it matches the query (`pay_specified`/`type`/`deadline_*` remain hard
include/exclude filters). Each result gets a `"relevance"` field in `[0, 1]`
(`null` when there's no `q`), computed per query word against `name` (weight 5),
`company` (weight 3), and `description` (weight 2):

1. **Exact whole-word match** scores highest.
2. **Substring match** scores next (this is what catches Estonian noun
   declensions, e.g. a query for `praktika` still substring-matches
   `praktikant`, `praktikandi`, etc. — which is also why a broad query like
   `praktika` ends up giving nearly every posting a nonzero score, since
   almost every title contains some form of that word).
3. **Fuzzy (edit-distance) match** against each word in the field catches
   typos and near-variants, scored lower and capped so it never outranks a
   real substring hit.

There's no semantic/synonym understanding here — "closeness" is purely
lexical (shared characters/substrings), not conceptual. Implementation is in
`include/search_ranking.hpp` / `src/search_ranking.cpp`.

#### Tags

Every posting also gets a `"tags"` array (e.g. `["Tarkvaraarendus", "Andmeteadus ja analüütika"]`,
possibly empty), computed once at load time in `include/tagging.hpp` /
`src/tagging.cpp`. It's a small rule-based dictionary — about 15 categories
(banking, software, data, marketing, HR, design, cybersecurity, engineering,
robotics, legal, sales, logistics, public sector, product, telecom), each
firing when one of its trigger keywords shows up in the posting's name,
company, or description. Matching is done against word tokens (equal to, or
a prefix of, the keyword) rather than a raw substring search, specifically to
avoid one word accidentally matching inside an unrelated compound word (e.g.
without that, `kommunikatsioon` would wrongly fire inside `telekommunikatsiooniandmeid`).
It's not a classifier and has no ML/training step — it's approximate and will
need occasional keyword tuning as new postings introduce vocabulary it
doesn't cover (currently one posting in the sample data ends up with no tags
at all, which is an expected gap, not a bug).

Filter by tag with the repeatable `tags` param (`tags=A&tags=B`, OR logic —
a posting needs at least one of the given tags). Unknown tag values return
`400` listing the valid ones, same pattern as `type`.

### `GET /api/facets`
Same query params as `/api/search` (any `tags` value passed is accepted but
ignored — facets always describe what's available to add, not what's already
selected). Returns tag counts under the *other* active filters:

```json
{ "tags": [ { "tag": "Pangandus ja rahandus", "count": 9 }, { "tag": "Tarkvaraarendus", "count": 6 }, ... ] }
```

Sorted by count descending, then alphabetically. This is what powers the
frontend's tag dropdown (checkbox + live count per tag) and doubles as a
"what categories exist under this search" breakdown. Since `q` only ranks
and never excludes results (see above), facet counts don't change based on
`q` alone — only `pay_specified`/`type`/`deadline_*`/`tags` narrow them.

### `GET /api/internships/:id`
Returns a single posting, or `404` with a JSON error body if the id doesn't exist.

### Example curl commands

```sh
# All postings
curl http://localhost:8080/api/internships

# Keyword search (Estonian text; URL-encode non-ASCII characters)
curl -G "http://localhost:8080/api/search" --data-urlencode "q=panga"

# Only postings with an actual pay amount listed
curl "http://localhost:8080/api/search?pay_specified=true"

# Full-time only
curl -G "http://localhost:8080/api/search" --data-urlencode "type=täiskoormusega"

# Deadline window
curl "http://localhost:8080/api/search?deadline_after=2026-09-01&deadline_before=2026-09-30"

# Combined filters
curl -G "http://localhost:8080/api/search" --data-urlencode "q=praktikant" -d "pay_specified=true" --data-urlencode "type=tähtajaline"

# Filter by tag (repeat the param for OR across multiple tags)
curl -G "http://localhost:8080/api/search" --data-urlencode "tags=Tarkvaraarendus" --data-urlencode "tags=Andmeteadus ja analüütika"

# Tag facet counts (add other filters to see counts narrow)
curl http://localhost:8080/api/facets
curl -G "http://localhost:8080/api/facets" --data-urlencode "type=tähtajaline"

# Single posting
curl http://localhost:8080/api/internships/5

# Error cases
curl -i "http://localhost:8080/api/search?pay_specified=maybe"   # 400
curl -i "http://localhost:8080/api/search?type=bogus"            # 400, lists valid types
curl -i -G "http://localhost:8080/api/search" --data-urlencode "tags=Bogus"  # 400, lists valid tags
curl -i http://localhost:8080/api/internships/does-not-exist     # 404
```

## Data

`data/internships.csv` has one row per posting with columns:

```
id,nimi,ettevõte,kirjeldus,tasu,tööaeg,tähtaeg,link
```

- `nimi` → `name`, `ettevõte` → `company`, `kirjeldus` → `description`
- `tasu` → `pay`: free-text compensation info, or the literal `Pole märgitud` when not specified (the API derives `pay_specified` from this)
- `tööaeg` → `employment_type`: free-text employment type (e.g. `täiskoormusega`, `tähtajaline`) — the backend doesn't hardcode an enum, it validates `type` search params and populates the frontend dropdown from whatever values are actually present in the CSV
- `tähtaeg` → `deadline`: ISO date, `YYYY-MM-DD`
- `link` → `link`: URL to the original posting

The CSV is loaded once at startup. Swap the file and restart the server to pick up changes — there's no database yet. The header row must match the Estonian column names above exactly.

## Test frontend

`public/index.html` + `public/js/app.js` is a plain-JS (no framework), fully Estonian-language page for manually exercising search: a keyword box, a "Tasu" (pay) filter (Kõik / Tasu märgitud / Pole märgitud), a "Tööaeg" dropdown populated dynamically from the loaded data, a "Tähtaeg" (deadline) date range, and a "Sildid" (tags) dropdown — a checkbox panel showing every tag with a live count of how many current results carry it (from `/api/facets`), refetched on every filter change so the counts stay accurate as you narrow down.

Results render as a single-line horizontal row per posting (not a card grid) — relevance badge, name, company, pay, employment type, tags, deadline, a truncated description (full text + tags on hover), and a link out to the original posting. When a keyword search is active: each row gets a percentage badge and a left-edge color tint proportional to its `relevance` score (closeness as layers, at a glance), and matched query words are bolded (`<mark>`) directly inside the name/company/pay/description text, so you can see *why* a result ranked where it did, not just trust the number.

Rows are also grouped into sections, computed client-side in `public/js/app.js` from the `relevance`/`tags` already in each `/api/search` result — no extra backend call:

- **With a query active:** three relevance tiers — "Parimad vasted" (≥ 0.5), "Seotud" (0.15–0.5), and "Vähem seotud" (< 0.15, collapsed by default behind a native `<details>` disclosure, since that tier is the most likely to just be noise on a specific query).
- **Browsing with no query:** grouped by each posting's primary tag (its first matched tag; taglessones land in "Muu"), sections ordered largest-first — a quick view of what categories exist in the current filter set.

The 0.5 / 0.15 tier cutoffs are hand-picked against this sample dataset's actual score spread, not derived from anything principled — expect to retune them if the postings or ranking algorithm change enough to shift the distribution.

It's served at `/` by the same backend and talks to `/api/search` via `fetch`. This is a throwaway test harness — the real frontend is a separate future project.
