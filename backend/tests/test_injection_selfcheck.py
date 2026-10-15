"""Self-check anti command-injection (task 4.1).

Memakai binary palsu yang merekam argv apa adanya, sehingga yang diuji adalah proses nyata
(`subprocess.run` sungguhan), bukan mock: payload harus tiba sebagai satu elemen argv utuh
dan tidak pernah dievaluasi shell.
"""
import re
import stat
from pathlib import Path

import pytest

from app.services import curl_service

APP_DIR = Path(__file__).resolve().parent.parent / "app"
CANARY_PAYLOADS = [
    "$(touch {c})",
    "`touch {c}`",
    "x; touch {c}",
    "x && touch {c}",
    "x | touch {c}",
    "x' ; touch {c} ; '",
    '"; touch {c}; "',
    "-o {c}",
    "--output {c}",
    "x\ttouch {c}",
]


@pytest.fixture
def fake_bins(tmp_path, monkeypatch):
    record = tmp_path / "argv.bin"
    script = tmp_path / "fake"
    script.write_text(
        "#!/bin/bash\n"
        f'printf "%s\\0" "$@" > "{record}"\n'
        'printf "HTTP/1.1 200 OK\\r\\n\\r\\n\\n__CURL__200|0.1|0.1|0"\n'
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    s = curl_service.get_settings()
    monkeypatch.setattr(s, "curl_bin", str(script))
    monkeypatch.setattr(s, "curl_allowed_ports", "80")
    return record


def _argv(record: Path) -> list[str]:
    return record.read_bytes().decode().split("\0")[:-1]


@pytest.mark.parametrize("payload", CANARY_PAYLOADS)
def test_header_value_payload_arrives_as_single_inert_argv_element(
    client, fake_bins, tmp_path, payload
):
    canary = tmp_path / "pwned"
    value = payload.format(c=canary)
    r = client.post(
        "/api/v1/curl/test",
        json={
            "target_domain": "app.local",
            "resolve_ip": "127.0.0.1",
            "port": 80,
            "protocol": "HTTP",
            "custom_headers": {"X-Test": value},
        },
    )
    assert r.status_code == 200, r.text
    argv = _argv(fake_bins)
    assert f"X-Test: {value}" in argv  # utuh, satu elemen
    assert argv[argv.index(f"X-Test: {value}") - 1] == "-H"  # selalu didahului -H
    assert not canary.exists()  # tidak ada eksekusi shell
    assert argv[-2:] == ["--", "http://app.local:80/"]  # URL tak bisa dibaca sebagai opsi


@pytest.mark.parametrize(
    "field,value",
    [
        ("target_domain", "app.local; touch x"),
        ("target_domain", "$(id)"),
        ("target_domain", "-oevil"),
        ("target_domain", "app.local --output /tmp/x"),
        ("resolve_ip", "127.0.0.1; id"),
        ("resolve_ip", "-o/tmp/x"),
        ("protocol", "http --output x"),
    ],
)
def test_malicious_structured_fields_rejected_before_any_process_runs(
    client, fake_bins, field, value
):
    body = {
        "target_domain": "app.local",
        "resolve_ip": "127.0.0.1",
        "port": 80,
        "protocol": "HTTP",
    }
    body[field] = value
    r = client.post("/api/v1/curl/test", json=body)
    assert r.status_code == 422
    assert not fake_bins.exists()  # binary tidak pernah dipanggil


@pytest.mark.parametrize("name", ["X-A\r\nInjected", "X A", "X-A:", "X;A", "$(id)", ""])
def test_header_names_rejected(client, fake_bins, name):
    r = client.post(
        "/api/v1/curl/test",
        json={
            "target_domain": "app.local",
            "resolve_ip": "127.0.0.1",
            "port": 80,
            "protocol": "HTTP",
            "custom_headers": {name: "v"},
        },
    )
    assert r.status_code == 422 and not fake_bins.exists()


def test_nginx_argv_is_fixed_regardless_of_user_input(client, tmp_path, monkeypatch):
    record = tmp_path / "nginx-argv.bin"
    script = tmp_path / "fake-sudo"
    script.write_text(
        f'#!/bin/bash\nprintf "%s\\0" "$@" > "{record}"\necho "syntax is ok" >&2\n'
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    s = curl_service.get_settings()
    monkeypatch.setattr(s, "sudo_bin", str(script))
    r = client.post("/api/v1/nginx/test", json={"site_id": None})
    assert r.status_code == 200
    assert _argv(record) == ["-n", "/usr/sbin/nginx", "-t"]
    # site_id bukan string: tidak ada jalur input pengguna ke argv nginx
    assert client.post("/api/v1/nginx/test", json={"site_id": "1; id"}).status_code == 422


def test_source_never_uses_shell_or_dynamic_eval():
    banned = re.compile(r"shell\s*=\s*True|os\.system|os\.popen|\beval\(|\bexec\(|subprocess\.getoutput")
    offenders = [
        f"{p.relative_to(APP_DIR)}:{i}"
        for p in APP_DIR.rglob("*.py")
        for i, line in enumerate(p.read_text().splitlines(), 1)
        if banned.search(line)
    ]
    assert offenders == []


def test_every_subprocess_call_passes_a_list():
    calls = [
        line
        for p in APP_DIR.rglob("*.py")
        for line in p.read_text().splitlines()
        if "subprocess.run(" in line
    ]
    assert calls and all("subprocess.run(argv" in c for c in calls)
