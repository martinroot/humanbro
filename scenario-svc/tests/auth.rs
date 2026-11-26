mod common;

use std::sync::Arc;

use axum::body::Body;
use axum::http::Request;
use http_body_util::BodyExt;
use tower::ServiceExt;

#[sqlx::test(migrations = "../server/migrations")]
async fn bearer_token_resolves_caller(pool: sqlx::PgPool) {
    let (org, user, token) = common::seed(&pool).await;
    let app = scenario_svc::router(Arc::new(scenario_svc::AppState { db: pool }));

    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/who")
                .header("Authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["user_id"].as_str().unwrap(), user.to_string());
    assert_eq!(v["org_id"].as_str().unwrap(), org.to_string());

    let res = app
        .oneshot(Request::builder().uri("/who").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), 401);
}
