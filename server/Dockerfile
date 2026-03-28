FROM ocaml/opam:debian-12-ocaml-5.2 AS builder
WORKDIR /app

# Install system deps
RUN sudo apt-get update && sudo apt-get install -y libssl-dev pkg-config

# Copy opam files first for layer caching
COPY texlyre-sync-server.opam ./
RUN opam install . --deps-only --yes

COPY . .
RUN opam exec -- dune build bin/main.exe

# ── Runtime image ──────────────────────────────────────────────────
FROM debian:12-slim
RUN apt-get update && apt-get install -y libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/_build/default/bin/main.exe /usr/local/bin/texlyre-sync

ENV LOCAL_ROOT=/data
ENV PORT=7331
EXPOSE 7331

VOLUME ["/data"]
ENTRYPOINT ["/usr/local/bin/texlyre-sync"]
