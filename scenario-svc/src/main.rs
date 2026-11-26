// SPDX-License-Identifier: AGPL-3.0-or-later
use std::sync::Arc;

use scenario_svc::{router, AppState};
use sqlx::postgres::PgPoolOptions;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let database_url =
        std::env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?;
    let db = PgPoolOptions::new()
        .max_connections(10)
        .after_release(|conn, _meta| {
            Box::pin(async move {
                sqlx::query("SELECT set_config('app.user_id', '', false)")
                    .execute(conn)
                    .await?;
                Ok(true)
            })
        })
        .connect(&database_url)
        .await?;

    let bind = std::env::var("BIND").unwrap_or_else(|_| "127.0.0.1:8902".into());
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("scenario-svc listening on {bind}");
    axum::serve(listener, router(Arc::new(AppState { db }))).await?;
    Ok(())
}
