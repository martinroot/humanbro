# Реестр баз скиллов и профилей

Схема GitHub: `https://github.com/<owner>/<repo>`. Ниже — owner/repo,
подставляй схему при запросе через API или `git clone`.

## Уровень 1 — нативные базы Hermes Agent (приоритет)

- Официальный каталог: локальный `hermes skills list` / docs Hermes (`hermes-agent.nousresearch.com`).
- ZeroPointRepo/awesome-hermes-skills — курируемый каталог 350+ скиллов/профилей.
- 0xarkstar/awesome-hermes-agent — бюджеты, модели, плагины.
- Anil-matcha/awesome-hermes-agent — деплой и мессенджеры.
- ChuckSRQ/awesome-hermes-skills — продакшн deep-research и PRD.
- lyndonkl/hermesworld — готовые дистрибутивы профилей «под ключ».
- smfworks/hermes-ai-team — мультиагентная команда и ночной ресерч.
- Поиск свежего: `gh search repos --topic hermes-skill --limit 10`.

## Уровень 2 — совместимые базы (SKILL.md совместим с Hermes)

- VoltAgent/awesome-openclaw-skills — дамп OpenClaw, 5400+ скиллов.
- ComposioHQ/awesome-claude-skills — SaaS-интеграции и паки субагентов.
- BehiSecc/awesome-claude-skills — фриланс-рутина: SEO, конкуренты, лиды, аутбонд.
- VoltAgent/awesome-agent-skills — кросс-платформенный сборник, 1000+.
- Поиск: `gh search repos --topic agent-skills --limit 10`.

## Уровень 3 — агрегаторы и приватные реестры

- Hermes Atlas: `https://hermesatlas.com/lists/top-skills`.
- LazySkills: `https://lazyskills.sh/skills/hermes-agent`.
- ClawHub: `https://clawskills.sh`, установка `npx clawhub install <slug>`,
  но приоритет — нативный `hermes skills install <identifier>`.
- nicolasmelo1/logion — верифицированные скиллы/MCP.
- iflytek/skillhub — приватные/корпоративные инстансы; проверять локальные
  эндпоинты в `config.yaml`.

## Быстрый локальный дамп (один раз)

```bash
mkdir -p ~/.hermes/skill-bases && cd ~/.hermes/skill-bases
for repo in \
  ZeroPointRepo/awesome-hermes-skills \
  0xarkstar/awesome-hermes-agent \
  Anil-matcha/awesome-hermes-agent \
  ChuckSRQ/awesome-hermes-skills \
  lyndonkl/hermesworld \
  smfworks/hermes-ai-team \
  VoltAgent/awesome-openclaw-skills \
  ComposioHQ/awesome-claude-skills \
  BehiSecc/awesome-claude-skills \
  VoltAgent/awesome-agent-skills \
  nicolasmelo1/logion \
  iflytek/skillhub
do
  gh repo clone "$repo" "${repo//\//__}" -- --depth 1
done
```

## Проверенные нативно CLI (факт 2026-11-19)

`hermes skills search` умеет источники: `all, official, skills-sh, well-known,
github, clawhub, lobehub, browse-sh, nvidia, openai, anthropic, huggingface,
voltagent, gstack, minimax`. Примеры, реально вернувшие результаты:
- `hermes skills search "pdf editing" --limit 3 --json` → `pdf-pro` (clawhub),
  `pdf-processing-pro` (skills-sh), `pdf-processing`.
- `hermes skills search "seo audit" --limit 2 --json` → `owl-seo-audit`,
  `ericlooi504-seo-audit` (clawhub).
- `hermes skills search "web scraping" --limit 2 --json` →
  `official/research/scrapling` (official).

Правило: `skills inspect` принимает **identifier** из `--json`, а не `name`.
