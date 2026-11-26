use std::sync::Arc;

use axum::body::Body;
use axum::http::Request;
use http_body_util::BodyExt;
use tower::ServiceExt;

#[sqlx::test(migrations = "../server/migrations")]
async fn healthz_returns_ok(pool: sqlx::PgPool) {
    let app = scenario_svc::router(Arc::new(scenario_svc::AppState { db: pool }));
    let res = app
        .oneshot(
            Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), 200);
    let body = res.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(
        String::from_utf8(body.to_vec()).unwrap(),
        r#"{"ok":true,"service":"scenario-svc"}"#
    );
}
