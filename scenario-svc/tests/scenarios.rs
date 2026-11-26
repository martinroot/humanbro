mod common;

use std::sync::Arc;

use axum::body::Body;
use axum::http::{Method, Request};
use http_body_util::BodyExt;
use serde_json::json;
use tower::ServiceExt;

#[sqlx::test(migrations = "../server/migrations")]
async fn create_and_list_scenario(pool: sqlx::PgPool) {
    let (org, _user, token) = common::seed(&pool).await;
    let app = scenario_svc::router(Arc::new(scenario_svc::AppState { db: pool }));

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/scn/scenarios")
                .method(Method::POST)
                .header("Authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "name": "yandex-farm",
                        "kind": "farm",
                        "project_id": null,
                        "spec": {"days": 7, "sites_per_day": [3,5], "at_once": 2},
                        "schedule_cron": "0 9 * * *",
                        "enabled": true
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    let res = app
        .oneshot(
            Request::builder()
                .uri("/scn/scenarios")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let list: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(list[0]["name"], "yandex-farm");
    assert_eq!(list[0]["kind"], "farm");
    assert_eq!(list.as_array().unwrap().len(), 1);
    let _ = org;
}
