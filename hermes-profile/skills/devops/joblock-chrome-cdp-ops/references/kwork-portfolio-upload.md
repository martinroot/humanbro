# Kwork portfolio upload (browser-automation one-off scripts)

Owner-driven flow for publishing works from the apimedia catalog (`apimedia-ads.json`, fields `id/title/video_url/thumb/script_url/topics`; titles are latin-1-mangled — decode with `decodeURIComponent(escape(s))`). Scripts live in browser-automation: `kwork-portfolio-one.ts` (one work per run) and the state file `kwork-portfolio-uploaded.json` (loaded IDs; reruns skip them).

## Form mechanics that cost a session to learn
- **`setInputFiles` on the Vue uploader does NOT trigger upload** — Kwork's handler ignores programmatic file assignment on `input.uploader`. Click the real control (`[data-type=media] .create-block`), catch the `page.waitForEvent('filechooser')`, then `chooser.setFiles(...)`. Retry up to 3× — filechooser timing is flaky.
- **Cover image is auto-generated from the video** by Kwork — do not upload a separate cover file (a separate cover input pattern in an older script overwrote the media file and produced «Необходимо загрузить обложку»).
- **After clicking «Сохранить» the form may stay open** — closing is not a success signal. Poll `/portfolio/get_popup` (`workNum`) until it increments; that is the only authoritative success check. Check the same popup before starting to know the baseline.
- **The form persists changes between opens.** A page reload is NOT enough; closing the modal raises a confirm dialog («очистить без изменений») that must be accepted, or the next run reuses stale title/media from the previous attempt. Full reset per work: close modal → accept clear → full `page.reload`.
- Wait for «Минимум 1 видео» to disappear from the page text before saving — Kwork processes the upload asynchronously (large files take 15+ s).
- Titles longer than 40 chars are rejected; the category path is Аудио, видео, съемка → ИИ-генерация видео (CATID 300) via the two `.selects-categories .vs__dropdown-toggle` selects.

## Reference data
- Category catalog with `CATID`, `parent`, `portfolio_type` (photo/video/audio/pdf/none), `max_photo_count` comes from the authenticated GET `/portfolio/get_popup` (saved copy: `portal/kwork-portfolio-catalog.json`, validator `portal/kwork_portfolio_config.py`).
- Work numbering: `workNum` starts at 30 (2 kworks pre-registered); treat any non-increment after save as failure only after waiting ~20 s — the counter lags.
- Stop the search parser and the portal's `order-details` thread for the whole upload session (see SKILL.md manual-work section); Kwork duplicate protection will otherwise reject IDs the owner uploaded manually.