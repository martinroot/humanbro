"""Watchdog: restart the Hermes messaging gateway if it is down.

Reads %LOCALAPPDATA%/hermes/gateway_state.json; if the recorded gateway is not
'running' or the PID is dead, runs `hermes gateway start`. Designed for a
Scheduled Task on a ~5 minute repetition interval.

Test manually:  python watchdog-gateway.py
Prints one line: 'gateway OK pid=<n>' or 'gateway DOWN ... -> starting'.
"""
import json, os, subprocess, sys

HERMES_HOME = r"C:\Users\Administrator\AppData\Local\hermes"
STATE = os.path.join(HERMES_HOME, "gateway_state.json")


def alive(pid):
    # tasklist emits CP866 on RU Windows; decode bytes with errors ignored.
    r = subprocess.run(["tasklist", "/FI", f"PID eq {pid}"], capture_output=True)
    out = (r.stdout or b"").decode("cp866", errors="ignore")
    return str(pid) in out


def main():
    try:
        d = json.load(open(STATE))
    except Exception:
        print("no gateway_state.json -> starting")
        state, pid = None, None
    else:
        state, pid = d.get("gateway_state"), d.get("pid")

    if state == "running" and pid and alive(pid):
        print(f"gateway OK pid={pid}")
        return

    print(f"gateway DOWN (state={state}, pid={pid}) -> starting")
    hermes = os.path.join(HERMES_HOME, "hermes-agent", "venv", "Scripts", "hermes.exe")
    subprocess.run(
        [hermes, "gateway", "start"],
        env={**os.environ, "HERMES_HOME": HERMES_HOME},
        capture_output=True, text=True, timeout=120,
    )


if __name__ == "__main__":
    main()
