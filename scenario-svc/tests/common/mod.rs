use sqlx::PgPool;
use uuid::Uuid;

pub async fn seed(pool: &PgPool) -> (Uuid, Uuid, String) {
    let (org, user) = (Uuid::now_v7(), Uuid::now_v7());
    sqlx::query("INSERT INTO organizations(id,name) VALUES($1,'test-org')")
        .bind(org)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO users(id,email,password_hash,public_key,wrapped_private_key,kdf_salt) \
         VALUES($1,'test@example.com','x',decode('00','hex'),decode('00','hex'),decode('00','hex'))",
    )
    .bind(user)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO org_members(org_id,user_id,role,wrapped_ork,ork_generation) \
         VALUES($1,$2,'owner',decode('00','hex'),1)",
    )
    .bind(org)
    .bind(user)
    .execute(pool)
    .await
    .unwrap();
    let token = "test-token";
    sqlx::query(
        "INSERT INTO sessions(token_hash,user_id,expires_at) \
         VALUES($1,$2,now() + interval '1 hour')",
    )
    .bind(fury_shared::hash_token(token))
    .bind(user)
    .execute(pool)
    .await
    .unwrap();
    (org, user, token.to_string())
}
