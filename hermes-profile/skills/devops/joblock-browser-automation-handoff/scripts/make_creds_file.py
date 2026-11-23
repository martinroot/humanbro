"""Собрать креды непрошедших аккаунтов в локальный файл, не печатая значения."""
import json, os, subprocess, stat
from pathlib import Path

PY = "C:/Users/Administrator/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe"
REG = "C:/Users/Administrator/browser-automation/reviews/registry.py"
OUT = "C:/Users/Administrator/AppData/Local/Temp/fury-install/failed_accounts_creds.txt"

items = [
    (4, 'rev_yandex_4', 'Яндекс требует номер телефона (auth/add)'),
    (18, 'rev_yandex_18', 'Яндекс требует номер телефона (auth/add)'),
    (16, 'rev_yandex_16', 'Прокси мёртв: ERR_TUNNEL_CONNECTION_FAILED'),
    (20, 'rev_yandex_20', 'Прокси мёртв: ERR_TUNNEL_CONNECTION_FAILED'),
]

lines = [
    'JobLock / Fury — аккаунты, не прошедшие авторизацию',
    'Логин, пароль и ответ на контрольный вопрос — из локального реестра.',
    'Файл конфиденциальный: не отправляйте его в чат или общие каналы.',
    '',
]
for acc_id, profile, reason in items:
    raw = subprocess.run([PY, REG, 'export-creds', '--account', str(acc_id)],
                         capture_output=True, text=True, check=True).stdout
    d = json.loads(raw)
    lines += [
        '--- аккаунт #%s · профиль Fury: %s' % (acc_id, profile),
        'Причина: ' + reason,
        'Логин: ' + str(d.get('login') or ''),
        'Пароль: ' + str(d.get('password') or ''),
        'Ответ на контрольный вопрос: ' + str(d.get('answer') or ''),
        '',
    ]
Path(OUT).write_text('\n'.join(lines), encoding='utf-8')
os.chmod(OUT, stat.S_IRUSR | stat.S_IWUSR)
print('written', OUT, 'accounts', len(items))
