use sqlx::PgPool;

#[sqlx::test(migrations = "../server/migrations")]
async fn scn_tables_exist(pool: PgPool) {
    let n: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM information_schema.tables
         WHERE table_schema = 'scn'
           AND table_name IN ('worker_nodes','scenarios','scenario_runs','scenario_tasks','scenario_events')",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(n, 5, "scn tables missing");
}
