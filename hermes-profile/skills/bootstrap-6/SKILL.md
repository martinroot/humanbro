---
name: bootstrap-6
description: Use when styling a site with Bootstrap 6 alpha.
---

# Bootstrap 6 Alpha

Use the official Bootstrap 6 alpha deliberately; it is pre-release, not a stable production line.

- Pin `bootstrap@6.0.0-alpha.1`; do not use an unversioned CDN URL.
- Bootstrap 6 JavaScript plugins are ESM-only. Load them with `<script type="module">`; do not use a classic script tag for the bundle.
- If the page needs only layout/components CSS, omit Bootstrap JavaScript entirely.
- Browser floor for this alpha: Chrome/Edge 130+, Firefox 132+, Safari 18+. Test against that floor before deployment; use Bootstrap 5.3.x if older browsers must work.
- Bootstrap 6 is an alpha with breaking changes; keep custom styling scoped and avoid claiming stable compatibility.
- Prefer locally vendored assets for production reliability; if using a CDN, verify the exact pinned URL and browser response.

Official references:
- https://getbootstrap.com/docs/versions/
- https://blog.getbootstrap.com/2026/10/08/bootstrap-6-alpha/
