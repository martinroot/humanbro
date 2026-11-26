// SPDX-License-Identifier: AGPL-3.0-or-later
//! Central scenario registry: auth, RLS-bound DB access and scenario CRUD.

use std::sync::Arc;

use axum::{
    extract::{FromRequestParts, State},
    http::{header::AUTHORIZATION, request::Parts, StatusCode},
    routing::{get, post},
    Json, Router,
};
use fury_shared::hash_token;
use serde::Deserialize;
use serde_json::json;
use sqlx::postgres::Postgres;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
}

#[derive(Debug, Clone, Copy)]
pub struct Caller {
    pub user_id: Uuid,
    pub org_id: Uuid,
}

impl FromRequestParts<Arc<AppState>> for Caller {
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or(StatusCode::UNAUTHORIZED)?;
        let row: Option<(Uuid, Uuid)> = sqlx::query_as(
            "SELECT s.user_id, m.org_id FROM sessions s \
             JOIN org_members m ON m.user_id = s.user_id \
             JOIN users u ON u.id = s.user_id \
             WHERE s.token_hash = $1 AND s.expires_at > now() AND u.disabled_at IS NULL",
        )
        .bind(hash_token(token))
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let (user_id, org_id) = row.ok_or(StatusCode::UNAUTHORIZED)?;
        Ok(Caller { user_id, org_id })
    }
}

/// A connection with `app.user_id` already bound. Handlers that forget to use
/// `Db` see nothing under FORCE RLS, which is the failure direction we want.
pub struct Db {
    pub caller: Caller,
    pub conn: sqlx::pool::PoolConnection<Postgres>,
}

impl FromRequestParts<Arc<AppState>> for Db {
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &Arc<AppState>,
    ) -> Result<Self, Self::Rejection> {
        let caller = Caller::from_request_parts(parts, state).await?;
        let mut conn = state
            .db
            .acquire()
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        sqlx::query("SELECT set_config('app.user_id', $1, false)")
            .bind(caller.user_id.to_string())
            .execute(&mut *conn)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        Ok(Db { caller, conn })
    }
}

#[derive(Deserialize)]
pub struct NewScenario {
    pub name: String,
    pub kind: String,
    pub project_id: Option<Uuid>,
    pub spec: serde_json::Value,
    pub schedule_cron: Option<String>,
    pub enabled: Option<bool>,
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/who", get(who))
        .route("/scn/scenarios", get(list_scenarios).post(create_scenario))
        .with_state(state)
}

async fn healthz() -> Json<serde_json::Value> {
    Json(json!({ "ok": true, "service": "scenario-svc" }))
}

async fn who(caller: Caller) -> Json<serde_json::Value> {
    Json(json!({ "user_id": caller.user_id, "org_id": caller.org_id }))
}

async fn create_scenario(
    mut db: Db,
    Json(input): Json<NewScenario>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if !matches!(input.kind.as_str(), "farm" | "warmup" | "custom") {
        return Err(StatusCode::BAD_REQUEST);
    }
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO scn.scenarios(id,org_id,project_id,name,kind,spec,schedule_cron,enabled,created_by) \
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    )
    .bind(id)
    .bind(db.caller.org_id)
    .bind(input.project_id)
    .bind(&input.name)
    .bind(&input.kind)
    .bind(&input.spec)
    .bind(input.schedule_cron)
    .bind(input.enabled.unwrap_or(true))
    .bind(db.caller.user_id)
    .execute(&mut *db.conn)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(json!({ "id": id, "org_id": db.caller.org_id })))
}

async fn list_scenarios(mut db: Db) -> Result<Json<serde_json::Value>, StatusCode> {
    let rows: Vec<(Uuid, String, String, serde_json::Value)> = sqlx::query_as(
        "SELECT id,name,kind,spec FROM scn.scenarios WHERE org_id=$1 ORDER BY created_at DESC",
    )
    .bind(db.caller.org_id)
    .fetch_all(&mut *db.conn)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let out: Vec<_> = rows
        .into_iter()
        .map(|(id, name, kind, spec)| json!({ "id": id, "name": name, "kind": kind, "spec": spec }))
        .collect();
    Ok(Json(json!(out)))
}
