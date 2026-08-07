# syntax=docker/dockerfile:1

# ---- Build stage ----
FROM debian:bookworm-slim AS build

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY CMakeLists.txt ./
COPY src ./src
COPY include ./include

RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build -j"$(nproc)"

# ---- Runtime stage ----
FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /src/build/internship_server ./internship_server
COPY public ./public
COPY data ./data

ENV HOST=0.0.0.0
ENV PORT=8080
ENV INTERNSHIP_DATA_PATH=/app/data/internships.csv
ENV INTERNSHIP_PUBLIC_DIR=/app/public
ENV USER_DATA_PATH=/app/userdata/users.json

EXPOSE 8080

CMD ["./internship_server"]
