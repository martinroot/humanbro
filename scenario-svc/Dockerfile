FROM rust:1-slim AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY shared-rs ./shared-rs
COPY server ./server
COPY scenario-svc ./scenario-svc
COPY agent ./agent
COPY platform-rs ./platform-rs
COPY desktop ./desktop
COPY tools ./tools
COPY shared ./shared
RUN cargo build --release -p scenario-svc

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10002 scn
COPY --from=build /src/target/release/scenario-svc /usr/local/bin/scenario-svc
USER scn
EXPOSE 8902
CMD ["scenario-svc"]
