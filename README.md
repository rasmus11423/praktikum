# Internship Search — Backend

A C++ HTTP server that loads internship postings from a CSV file and exposes
a search/filter JSON API, plus a minimal static test frontend served from the
same process. This is backend-focused scaffolding; the real frontend comes later.

## Project layout

```
/src        C++ source
/include    headers
/data       internships.csv (loaded read-only at startup)
/userdata   users.json (accounts/favorites/etc., created at runtime — gitignored)
/public     minimal test frontend (html/css/js), served at "/"
/docker     Dockerfile, docker-compose.yml
CMakeLists.txt
```

## Tech stack

- C++17, built with CMake.
- [cpp-httplib](https://github.com/yhirose/cpp-httplib) for HTTP, fetched via CMake `FetchContent`.
- [nlohmann/json](https://github.com/nlohmann/json) for JSON, fetched via CMake `FetchContent` — also used as the storage format for user accounts (`userdata/users.json`), read/written directly rather than through a database.
- [PicoSHA2](https://github.com/okdshin/PicoSHA2) (single-header SHA-256), fetched via CMake `FetchContent`, as the primitive underneath a hand-written HMAC-SHA256/PBKDF2 password hasher (`src/password_hash.cpp`) — see "Accounts" below for why it's PBKDF2 and not bcrypt/argon2, and why there's no database yet.
- A small hand-written CSV parser (`src/csv_parser.cpp`) — the schema is simple enough not to need a dependency.

No manual library installs are needed beyond CMake and a compiler — `FetchContent` downloads and builds cpp-httplib, nlohmann/json, and PicoSHA2 as part of the CMake configure/build step (requires network access the first time).

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
./build/internship_server --port 9090 --data data/internships.csv --public public --userdata userdata/users.json
# or
PORT=9090 INTERNSHIP_DATA_PATH=data/internships.csv INTERNSHIP_PUBLIC_DIR=public USER_DATA_PATH=userdata/users.json ./build/internship_server
```

Then open `http://localhost:8080/` in a browser for the test frontend, or `http://localhost:8080/profile.html` to register/log in.

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

`data/` is mounted read-only into the container, so you can swap in a new CSV without rebuilding the image — just restart the container to pick up the change (data is loaded once at startup). `userdata/` is mounted read-write, so accounts survive `docker compose down`/`up` (they only vanish if you delete the host `userdata/` directory).

To build/run the image manually without compose:

```sh
docker build -f docker/Dockerfile -t internship-server .
docker run --rm -p 8080:8080 \
  -v "$(pwd)/data:/app/data:ro" \
  -v "$(pwd)/userdata:/app/userdata" \
  internship-server
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

#### Default order: soonest deadline first

Without a `q`, results (and `/api/internships`) are always sorted by
deadline ascending — the posting closing soonest comes first. Rolling
("Pidev") postings, having no date to be urgent about, always sort after
every dated posting. This is the base order everywhere; a `q` query
overrides it with relevance order (below).

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

# Register, then use the saved session cookie for authenticated requests
curl -c cookies.txt -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" -d '{"email":"you@example.com","password":"at-least-8-chars"}'
curl -b cookies.txt -X POST http://localhost:8080/api/me/favorites \
  -H "Content-Type: application/json" -d '{"internship_id":"1"}'
curl -b cookies.txt http://localhost:8080/api/me/favorites

# Error cases
curl -i "http://localhost:8080/api/search?pay_specified=maybe"   # 400
curl -i "http://localhost:8080/api/search?type=bogus"            # 400, lists valid types
curl -i -G "http://localhost:8080/api/search" --data-urlencode "location=Bogus"  # 400, lists valid locations
curl -i -G "http://localhost:8080/api/search" --data-urlencode "tags=Bogus"  # 400, lists valid tags
curl -i http://localhost:8080/api/internships/does-not-exist     # 404
```

## Accounts

Registration/login and a per-account profile (favorites, saved search
presets, recently-viewed history). Deliberately **not** backed by a real
database yet — see the caveats below before using this for anything beyond
local testing.

### `POST /api/auth/register`
Body: `{"email": "...", "password": "..."}`. Password must be 8+ characters;
email must look like an email and not already be registered (checked
case-insensitively). On success (`201`), sets a `session` cookie and returns
`{"id", "email", "created_at"}` — never the password or its hash.

### `POST /api/auth/login`
Body: `{"email": "...", "password": "..."}`. `401` with a single generic
"Invalid email or password" message on any failure (wrong password *or*
unknown email) — this is deliberate, both to avoid confirming which emails
are registered and because the server does constant-time-ish work either way
(see "Password hashing" below). On success, sets the `session` cookie and
returns the same user object as register.

### `POST /api/auth/logout`
Destroys the current session server-side and clears the cookie. `204`, no body.

### `GET /api/auth/me`
Returns the current user (from the `session` cookie) or `401` if not logged
in. Every page checks this on load to decide whether to show a login form or
profile content.

### `/api/me/*` — requires login (`401` otherwise)
All operate on whichever account the `session` cookie resolves to.

| endpoint | method | notes |
|---|---|---|
| `/api/me/favorites` | `GET` | full posting objects for your favorited ids (silently skips any that expired/no longer exist) |
| `/api/me/favorites` | `POST` | body `{"internship_id": "..."}`; `404` if the id isn't an active posting |
| `/api/me/favorites/:id` | `DELETE` | idempotent — removing something not favorited is still `204` |
| `/api/me/searches` | `GET` | your saved filter presets: `{id, name, query, created_at}` |
| `/api/me/searches` | `POST` | body `{"name": "...", "query": "..."}` — `query` is a raw querystring (e.g. `"type=t%C3%A4iskoormusega&location=Tallinn"`), applied by the frontend via `/?<query>` |
| `/api/me/searches/:id` | `DELETE` | |
| `/api/me/history` | `GET` | your 20 most recently viewed postings, newest first, each with a `viewed_at` timestamp attached |
| `/api/me/history` | `POST` | body `{"internship_id": "..."}`; re-viewing something already in the list moves it to the front instead of duplicating |

Auth uses an `HttpOnly`, `SameSite=Lax` session cookie (7-day `Max-Age`), **not marked `Secure`** since local dev runs over plain HTTP — add `Secure` and serve over HTTPS before any real deployment. There's no CSRF token; `SameSite=Lax` is the only mitigation, which is a reasonable-but-incomplete baseline for a prototype.

### Password hashing

PBKDF2-HMAC-SHA256, 120,000 iterations, a random 16-byte salt per account,
constant-time comparison on verify (`src/password_hash.cpp`, built on the
vendored PicoSHA2 primitive). This is a legitimate, standard KDF — not
"invented crypto" — but bcrypt/argon2 (memory-hard, purpose-built for
passwords) would be the right upgrade before any real deployment. Login also
does a dummy hash verification when the email isn't found, so response
timing doesn't reveal which emails are registered.

### Why no SQL yet

User data lives in a single JSON file (`userdata/users.json`), guarded by an
in-process mutex and rewritten in full on every mutation
(`src/user_store.cpp`). That's fine at the scale of a handful of test
accounts with infrequent writes, but it doesn't give you real concurrent-write
safety, indexing, or querying — a real database is the right move before this
sees meaningful traffic or user counts. Sessions themselves are in-memory
only (`src/session_store.cpp`) and are lost on restart by design — that just
means logging in again, not losing data, so it didn't need to be persisted.

### CV upload

The profile page has a CV section, but it's a **UI-only placeholder** — a
disabled file input with no upload wired up. Actually storing uploaded files
needs size limits, content-type validation, and a storage location decision
that haven't been made yet.

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

Plain HTML/CSS/JS (no framework), fully Estonian-language, four pages served
statically from `public/` by the same backend: `/` (search/browse),
`/profile.html` (account), `/guide.html` (static application advice), plus
shared `css/design-system.css` + `css/style.css`.

### Design system

The visual design (colors, typography, spacing/radius/shadow tokens) was
ported from a Claude-generated design draft — a set of `.dc.html` mockups
built with a proprietary prototyping tool (custom `<x-dc>` template tags
bound to a bundled React runtime) that aren't portable code themselves, but
included a genuinely reusable plain-CSS token file. `public/css/design-system.css`
is that file, adapted from the source's manual `[data-mode="dark"]` attribute
to this project's existing `@media (prefers-color-scheme: dark)` convention.
Self-hosted Inter Variable font files live in `public/fonts/` (no external
font CDN). `public/css/style.css` holds the actual component styles (header,
search panel, cards, dropdowns, modal, etc.) built on top of those tokens.

The mockup itself envisioned a much bigger product — an employer dashboard
for posting/managing jobs, a drag-and-drop application-tracking kanban board,
and a profile-based "% match" recommendation engine. None of that was built:
it needs backend concepts this project doesn't have (employer accounts, an
applications data model, declared-major matching) and wasn't asked for.
What *did* carry over from the mockup: the browse/search page's visual
language, wired to our real data — our tags become the "field" filter, and
our existing `relevance` score becomes the "% match" badge, not a fabricated
number.

### Search / browse page (`/`)

A hero banner sits above a floating search panel: a full-width search input,
plus standalone filter controls (not one consolidated dropdown) — a "Tasu"
segmented control (Kõik / Tasustatud / Tasustamata), "Tööaeg" and "Asukoht"
single-select dropdowns (populated dynamically from the loaded data), a
"Valdkond" (tag) checkbox dropdown with live facet counts, and a "Tähtaeg"
date range. Every control re-searches immediately on change; the search box
debounces briefly as you type. There's no visible submit button, but Enter
in the search box still works via the form's submit handler.

Results render as **cards (grid) or rows (list)**, toggled via the icons
above the results — same underlying data, two layouts. Since there are no
company logos in the data, each posting gets a deterministic colored
initial-letter avatar (same company always gets the same color, computed
client-side by hashing the name). Clicking a card/row (other than the
favorite star) opens a **detail modal** with the full description, all tag
and keyword chips (keyword chips get the same query-match highlighting as
the card text, since an English search term will often only match there), a
"Kandideeri" button linking to the real posting URL, and a favorite toggle —
this replaces the previous inline expand-row, since that doesn't work in
grid view.

Results are still grouped into sections (relevance tiers when a query is
active, tag groups when browsing), and the deadline is still color-coded by
urgency (red ≤3 days, yellow ≤7 days) — both unchanged in logic from before,
just restyled. See "Default order: soonest deadline first" and "How `q`
ranking works" above for the underlying rules.

**Notifications** (the bell icon, top right) are new: a badge dot appears
when any of *your* favorited postings has a deadline within 7 days. This is
computed entirely client-side from data already available (your favorites'
`deadline`/`deadline_rolling` fields) — no new backend endpoint. Signed out,
it works off the same `localStorage` favorites as before; signed in, off the
account's real favorites.

Signed in, a "☆ Salvesta otsing" button appears to save the current filter
combination as a named preset, and the header link shows your email instead
of "Logi sisse". Favoriting calls the account API directly instead of
`localStorage` once signed in.

### Profile page (`/profile.html`)

Unchanged in substance from before, restyled to match: signed out, a
login/register form; signed in, your email + account creation date with a
log-out button, a CV section that's a **UI-only placeholder** (disabled file
input, nothing actually uploads), your favorited postings (removable), your
saved search presets (each a link back to `/?<query>` that reproduces those
filters — the main page seeds its filter state from the URL on load — and
deletable), and your 20 most recently viewed postings. All from the
`/api/me/*` endpoints documented above.

### Application guide (`/guide.html`)

Static content — CV-writing and motivation-letter advice, and what each
interview stage actually evaluates — adapted and translated from the
mockup's Application Guide page. No backend involvement at all.
