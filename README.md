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
  "name": "Forward Deployed Software Engineer, Internship – Commercial",
  "company": "Palantir Technologies",
  "description": "Rahvusvahelise andmeanalüüsi ja tarkvaraettevõtte praktika…",
  "pay": "Pole märgitud",
  "pay_specified": false,
  "employment_type": "täiskoormusega",
  "deadline": "2027-05-01",
  "deadline_rolling": false,
  "link": "https://jobs.lever.co/palantir/599b1907-.../",
  "location": "Ühendkuningriik",
  "source": "praktika.ut.ee",
  "keywords": ["tarkvaraarendus-software engineering", "andmeanalüüs-data analysis", "infotehnoloogia-IT", "..."],
  "tags": ["IT ja digilahendused", "Tarkvaraarendus", "Andmeteadus ja analüütika"]
}
```

- `pay_specified` is derived server-side: `false` when `pay` is the CSV's "Pole märgitud" (not specified) placeholder or empty, `true` otherwise. There's no separate paid/unpaid boolean in the data.
- `deadline_rolling` is `true` when `deadline` isn't a fixed ISO date — the CSV sometimes uses free text like `Pidev` (ongoing/rolling admission) instead. A rolling posting never expires and can't be matched by `deadline_before`/`deadline_after` (see "Expired postings are hidden" below).
- `location` and `source` are free text from the CSV (`asukoht`, `leitud_portaalist`) — where the posting is and which portal it was found on.
- `keywords` are curated Estonian-English phrases from the CSV (e.g. `"tarkvaraarendus-software engineering"`), kept as whole phrases rather than split into two languages — see "How `q` ranking works" below for why, and how they make the English half searchable too.

### `GET /api/search`
Query params (all optional, combinable):

| param             | example        | notes                                              |
|-------------------|----------------|-----------------------------------------------------|
| `q`                | `q=panga` | **ranks, doesn't filter** — see "How `q` ranking works" below |
| `pay_specified`    | `pay_specified=true` | `true` or `false` — whether `pay` lists an actual amount vs. "Pole märgitud" |
| `type`             | `type=täiskoormusega`| must match one of the `employment_type` values actually present in the data — validated dynamically, not hardcoded |
| `location`         | `location=Tallinn`   | must match one of the `location` values actually present in the data — same dynamic validation as `type` |
| `tags`             | `tags=Pangandus%20ja%20rahandus` | repeatable (`tags=A&tags=B`); OR-matched (posting needs at least one), validated against tags actually present in the data — see "Tags" below |
| `deadline_after`   | `deadline_after=2026-09-01` | ISO date, inclusive lower bound; excludes postings with a rolling ("Pidev") deadline, since there's no date to compare |
| `deadline_before`  | `deadline_before=2026-09-30`| ISO date, inclusive upper bound; same rolling-deadline exclusion as above |

Invalid values (e.g. `pay_specified=maybe`, an unknown `type`/`location`, a malformed date) return `400` with a JSON `{"error": "..."}` body listing the currently valid values where applicable.

#### How `q` ranking works

Unlike the other params, `q` does **not** exclude non-matching postings — every
posting that passes the other filters is still returned, just sorted by how
closely it matches the query (`pay_specified`/`type`/`location`/`deadline_*`
remain hard include/exclude filters). Each result gets a `"relevance"` field
in `[0, 1]` (`null` when there's no `q`), computed per query word against
`name` (weight 5), `keywords` (weight 4), `company` (weight 3), and
`description` (weight 2). Because the CSV's `keywords` column pairs each
Estonian term with its English translation (e.g. `"tarkvaraarendus-software
engineering"`) and tokenizing splits on the `-`, both halves become
independently searchable — searching `hospitality` or `accommodation`
(English-only, not present anywhere in the Estonian name/description) still
correctly surfaces hotel postings via their `majutus-accommodation` /
`hotellindus-hospitality` keywords.

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
`src/tagging.cpp`. It's a small rule-based dictionary — about 19 categories
(banking, software, data, marketing, HR, design, cybersecurity, engineering,
robotics, legal, sales, logistics, public sector, product, telecom,
hospitality & tourism, agriculture & horticulture, art & culture,
environment & sustainability), each firing when one of its trigger keywords
shows up in the posting's name, company, description, *or* keywords. Matching
is done against word tokens (equal to, or a prefix of, the keyword) rather
than a raw substring search, specifically to avoid one word accidentally
matching inside an unrelated compound word (e.g. without that,
`kommunikatsioon` would wrongly fire inside `telekommunikatsiooniandmeid`,
and `iot` would wrongly fire inside `äriotsuste`). It's not a classifier and
has no ML/training step — it's approximate and will need occasional keyword
tuning as new postings introduce vocabulary it doesn't cover. The last four
categories (hospitality, agriculture, art, environment) were added because
the current dataset has real clusters of postings in those areas that the
original ~15-category dictionary had zero coverage for; every posting in the
current sample now gets at least one tag.

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
`q` alone — only `pay_specified`/`type`/`location`/`deadline_*`/`tags` narrow them.

### `GET /api/internships/:id`
Returns a single posting, or `404` with a JSON error body if the id doesn't exist.

### Example curl commands

```sh
# All postings
curl http://localhost:8080/api/internships

# Keyword search — Estonian or English both work (URL-encode non-ASCII characters)
curl -G "http://localhost:8080/api/search" --data-urlencode "q=panga"
curl -G "http://localhost:8080/api/search" --data-urlencode "q=hospitality"

# Only postings with an actual pay amount listed
curl "http://localhost:8080/api/search?pay_specified=true"

# Full-time only
curl -G "http://localhost:8080/api/search" --data-urlencode "type=täiskoormusega"

# By location
curl -G "http://localhost:8080/api/search" --data-urlencode "location=Tallinn"

# Deadline window (rolling/"Pidev" postings are excluded from this, by design)
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
curl -i -G "http://localhost:8080/api/search" --data-urlencode "location=Bogus"  # 400, lists valid locations
curl -i -G "http://localhost:8080/api/search" --data-urlencode "tags=Bogus"  # 400, lists valid tags
curl -i http://localhost:8080/api/internships/does-not-exist     # 404
```

## Data

`data/internships.csv` has one row per posting with columns:

```
id,nimi,ettevõte,kirjeldus,tasu,tööaeg,tähtaeg,link,asukoht,leitud_portaalist,keywords
```

- `nimi` → `name`, `ettevõte` → `company`, `kirjeldus` → `description`
- `tasu` → `pay`: free-text compensation info, or the literal `Pole märgitud` when not specified (the API derives `pay_specified` from this)
- `tööaeg` → `employment_type`: free-text employment type (e.g. `täiskoormusega`, `osaline tööaeg`, `kaugtöö`) — the backend doesn't hardcode an enum, it validates `type` search params and populates the frontend dropdown from whatever values are actually present in the CSV
- `tähtaeg` → `deadline`: usually an ISO date (`YYYY-MM-DD`), but can be free text like `Pidev` for rolling/ongoing admission — see `deadline_rolling` above and "Expired postings are hidden" below
- `link` → `link`: URL to the original posting (sometimes a `mailto:` address, or explanatory text when no direct posting page exists)
- `asukoht` → `location`: free text, e.g. `Tallinn`, `Kaugtöö` (remote), `Läti / Kaugtöö` — validated/filterable the same dynamic way as `employment_type`
- `leitud_portaalist` → `source`: which portal the posting was found on, e.g. `career.taltech.ee`, `ehrl.ee` — display-only, not currently filterable
- `keywords` → `keywords`: semicolon-separated Estonian-English phrase pairs, e.g. `tarkvaraarendus-software engineering; andmeanalüüs-data analysis`. Each phrase is kept whole (not split into two languages — several are ambiguous to split, like `front-end-front-end`), and fed into both search ranking and tagging; see "How `q` ranking works" above.

The CSV is loaded once at startup. Swap the file and restart the server to pick up changes — there's no database yet. The header row must match the Estonian column names above exactly.

### Expired postings are hidden

Every read path (`/api/internships`, `/api/search`, `/api/facets`, and
`/api/internships/:id`) only ever considers postings whose `deadline` is
today or later (server local time), **or** whose deadline is rolling
(`deadline_rolling: true`, e.g. `Pidev`) — a rolling posting never expires,
since there's no fixed date to compare. A posting with a genuinely past
deadline behaves as if it doesn't exist: it's excluded from
listings/search/facets, and fetching it directly by id returns `404`, the
same as an unknown id. This is computed fresh on every request rather than
once at CSV load time, so a posting correctly drops out the day after its
deadline passes without needing a server restart — no cron job or background
task needed for this simple a rule. See `InternshipStore::active_items()` in
`src/internship_store.cpp`.

## Test frontend

`public/index.html` + `public/js/app.js` is a plain-JS (no framework), fully Estonian-language page for manually exercising search. The search box is the dominant, centered element; filters live in two dropdowns flanking it rather than a row of separate controls:

- **Filtrid** (left): the "Tasu" pay filter (Kõik / Tasu märgitud / Pole märgitud), the "Tööaeg" dropdown, an "Asukoht" (location) dropdown, and a "Tähtaeg" deadline range — all consolidated into one panel, "Tööaeg"/"Asukoht" both populated dynamically from the loaded data.
- **Sildid** (right): the tag checkbox panel with live facet counts, unchanged from before except it now opens downward instead of upward.

There's no "Otsi"/"Lähtesta" button anymore — search runs automatically: the search box re-searches on a short debounce as you type, every other control re-searches immediately on change, and pressing Enter in the search box still works too (the `<form>` submit handler is still there, just without a visible button).

Results render as a single-line horizontal row per posting (not a card grid) — a favorite-star toggle, relevance badge, name, company, pay, employment type, tags, deadline, a truncated description, and a link out to the original posting. Clicking anywhere on a row (other than the star or the outbound link) expands an inline panel below it with the full description, location/deadline/source, tag chips, and keyword chips — a CSS grid-based collapse/expand animation, no layout-measuring JS needed. Keywords in the expanded panel get the same query-match highlighting as the compact row's name/company/description, since an English search term will often only match there. The favorite star persists to `localStorage`, so favorited postings survive a page reload; there's no dedicated "favorites only" filter yet, just the per-row toggle.

When a keyword search is active: each row gets a percentage badge and a left-edge color tint proportional to its `relevance` score (closeness as layers, at a glance), and matched query words are bolded (`<mark>`) directly inside the name/company/pay/description text, so you can see *why* a result ranked where it did, not just trust the number.

Rows are also grouped into sections, computed client-side in `public/js/app.js` from the `relevance`/`tags` already in each `/api/search` result — no extra backend call:

- **With a query active:** three relevance tiers — "Parimad vasted" (≥ 0.5), "Seotud" (0.15–0.5), and "Vähem seotud" (< 0.15, collapsed by default behind a native `<details>` disclosure, since that tier is the most likely to just be noise on a specific query).
- **Browsing with no query:** grouped by each posting's primary tag (its first matched tag; taglessones land in "Muu"), sections ordered largest-first — a quick view of what categories exist in the current filter set.

The 0.5 / 0.15 tier cutoffs are hand-picked against this sample dataset's actual score spread, not derived from anything principled — expect to retune them if the postings or ranking algorithm change enough to shift the distribution.

It's served at `/` by the same backend and talks to `/api/search` via `fetch`. This is a throwaway test harness — the real frontend is a separate future project.
