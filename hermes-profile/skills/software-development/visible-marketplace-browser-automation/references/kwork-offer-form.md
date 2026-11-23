# Kwork offer form (`kwork.ru/new_offer?project=<id>`)

Field map and fill recipes verified against the live form. Read this when
automating a Kwork offer; the general selector rules live in SKILL.md.

## Field map

| Field | Selector | Notes |
|---|---|---|
| Description | `textarea[name=description]` | Visible, but Trumbowyg-backed |
| Order name | `.trumbowyg-editor` next to `textarea[name=name]` | Hidden `textarea[name=name]` is `tabindex="-1"`; filling it does nothing visible |
| Price | `#offer-custom-price` (`input[type=tel]`) | Placeholder is a range, e.g. `2 000 - 30 000` |
| Deadline | `.duration-select .vs__dropdown-toggle` → `.vs__dropdown-option` | vue-select, no native `<select>` in the DOM |
| Submit | element whose trimmed `innerText` is exactly `Предложить` | Often wrapped in `span.kw-button`; Playwright locators miss it, `querySelectorAll` finds it |

## Description minimum

The description field rejects under **150 characters** with
«В поле описания должно быть написано не менее 150 символов». The form also
asks how you will solve the client's task, so a short generic "ready to do it"
reply is rejected twice over. Build a separate, longer offer text that includes
an explicit approach paragraph plus a delivery note.

## Fill order that works

1. Fill description and price via `locator.fill()`.
2. Set the name through the editor, then verify propagation:
   ```ts
   const ta = document.querySelector("textarea[name=name]");
   const ed = ta.parentElement.querySelector(".trumbowyg-editor");
   ed.innerHTML = value;
   ed.dispatchEvent(new Event("input", { bubbles: true }));
   ed.dispatchEvent(new Event("change", { bubbles: true }));
   // then read ta.value back to confirm
   ```
3. Open the deadline dropdown with a real `locator.click()` on the toggle,
   wait ~1s, then click the first `.vs__dropdown-option`.
4. Click `Предложить` via `evaluate`, then confirm by reading state back.

## Debuggable form

- Hidden error text is often the only explanation, and stale highlighted errors
  survive a corrected value. On failure, dump: visible `[class*=error]` text,
  `textarea[name=description]`.value.length, `#offer-custom-price`.value, the
  `.duration-select .vs__selected` text, and any visible modal/toast.
- If the post-submit page lands on the feed, the form closed but nothing proves
  an offer exists. The offer list is an SPA route: read the nav item's real
  `href` from the DOM rather than guessing a path (a wrong guess either 404s or
  silently shows the feed), and prefer checking the project page for an
  own-response marker.
- A project can close between discovery and submission. Re-read the project
  state and report the listing as taken rather than retrying.
