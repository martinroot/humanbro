// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright 2026 Bogdan Shapovalov and the Fury authors

//! Types shared between `fury-server` and `fury-agent`.
//!
//! Everything here is transport-agnostic: no axum, no sqlx, no reqwest. Both
//! sides depend on this crate so the wire format cannot drift.

pub mod totp;
pub mod api;
pub mod capture;
pub mod domains;
pub mod extensions;
pub mod catalogue;
pub mod fingerprint;
pub mod fonts;
pub mod keys;
pub mod recovery;
pub mod locale;
pub mod overrides;
pub mod persona;
pub mod proxy_list;
pub mod rbac;

pub use fingerprint::FingerprintConfig;
pub use persona::{Persona, ProfileContext};
pub use rbac::{effective, LaunchRestrictions, OrgRole, Perm, PermSet};

use sha2::{Digest, Sha256};

/// Session tokens are hashed with SHA-256 into BYTEA. Shared by server and
/// scenario-svc so a change on one side cannot silently lock the other out.
pub fn hash_token(raw: &str) -> Vec<u8> {
    Sha256::digest(raw.as_bytes()).to_vec()
}

/// Bumped when the fingerprint config schema changes in a way the core must
/// know about. The core refuses to start on an unknown version rather than
/// silently ignoring fields it does not understand.
pub const FINGERPRINT_SCHEMA_VERSION: u32 = 1;

#[cfg(test)]
mod tests {
    use super::hash_token;

    #[test]
    fn token_hash_is_sha256_bytes() {
        assert_eq!(
            hash_token("abc"),
            vec![
                0xba, 0x78, 0x16, 0xbf, 0x8f, 0x01, 0xcf, 0xea, 0x41, 0x41, 0x40, 0xde,
                0x5d, 0xae, 0x22, 0x23, 0xb0, 0x03, 0x61, 0xa3, 0x96, 0x17, 0x7a, 0x9c,
                0xb4, 0x10, 0xff, 0x61, 0xf2, 0x00, 0x15, 0xad
            ]
        );
    }
}
