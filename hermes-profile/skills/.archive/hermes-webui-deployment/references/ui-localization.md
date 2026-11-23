# Localizing a browser UI

## Inventory

1. Find all locale dictionaries and keys referenced by `data-i18n`, `data-i18n-placeholder`, ARIA/title attributes, and `t('key')` calls.
2. Scan templates and JavaScript for direct user-visible literals in prompts, `textContent`, `innerHTML`, toasts, confirmation dialogs, loading/error states, and status renderers.
3. Compare key sets across supported locales. Every locale should contain the same UI keys; keep machine state values and IDs unchanged, translating their display labels only.

## Implement

- Set the document language and first-run locale intentionally; preserve an existing valid user choice.
- Keep the language toggle cycle explicit when adding a locale; update its accessible label to the next locale.
- Translate placeholders, dialog copy, API-auth prompts, confirmation text, empty/loading states, and dynamic messages—not just static page labels.
- Store user-entered API tokens only in session storage, send them through request headers, and never localize or log the token itself.
- If modules are imported with cache-busting query versions, update all references to the shared locale module and the HTML entrypoint together. Different query strings create distinct ES module instances with independent locale state.

## Verify

- Script-check that locale dictionaries have matching keys and that every referenced `t()`/`data-i18n` key exists.
- Search for remaining source-language literals in UI templates and dynamic handlers; classify technical identifiers separately from human-facing text.
- Run existing static/unit tests, then use a browser smoke check to switch every locale, open task/board/workflow/auth dialogs, trigger validation/toasts, and reload to confirm the choice persists.
- Verify no API token is present in HTML, JavaScript constants, URLs, or browser localStorage when session-only storage is intended.
