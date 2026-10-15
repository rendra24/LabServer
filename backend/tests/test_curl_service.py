import subprocess
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from app.errors import AppError
from app.schemas import CurlTestRequest
from app.services import curl_service as cs


def req(**over):
    base = {
        "target_domain": "app.local",
        "resolve_ip": "127.0.0.1",
        "port": 80,
        "protocol": "HTTP",
        "custom_headers": {"Host": "app.local"},
    }
    return CurlTestRequest(**{**base, **over})


def _proc(rc=0, out="", err=""):
    return subprocess.CompletedProcess(args=[], returncode=rc, stdout=out, stderr=err)


OK_OUT = (
    "HTTP/1.1 200 OK\r\nServer: nginx\r\nContent-Type: text/html\r\nSet-Cookie: a=1\r\n"
    "Set-Cookie: b=2\r\n\r\n\n__CURL__200|0.012345|0.020000|0"
)


# --- validasi input (batas sistem) ---------------------------------------------------------
@pytest.mark.parametrize(
    "domain", ["a b", "a;rm -rf /", "-oevil", "a$(id)", "a`id`", "a|b", "a&b", "a\nb", "", "a/b", "a:80"]
)
def test_domain_rejects_shell_and_argument_injection(domain):
    with pytest.raises(ValidationError):
        req(target_domain=domain)


@pytest.mark.parametrize("ip", ["127.0.0.1;id", "999.1.1.1", "localhost", "1.2.3", "$(id)", " 1.1.1.1"])
def test_resolve_ip_must_be_valid_ip(ip):
    with pytest.raises(ValidationError):
        req(resolve_ip=ip)


@pytest.mark.parametrize("port", [0, 65536, -1])
def test_port_range(port):
    with pytest.raises(ValidationError):
        req(port=port)


def test_protocol_enum():
    with pytest.raises(ValidationError):
        req(protocol="FTP")


@pytest.mark.parametrize(
    "headers",
    [
        {"X-A": "ok\r\nInjected: 1"},
        {"X-A": "a\nb"},
        {"X-A\r\nB": "v"},
        {"X A": "v"},
        {"X-A:": "v"},
        {"": "v"},
        {"X-A": "a\x00b"},
    ],
)
def test_headers_reject_injection(headers):
    with pytest.raises(ValidationError):
        req(custom_headers=headers)


# --- perakitan perintah ---------------------------------------------------------------------
def test_command_is_fixed_argv_with_each_input_as_one_element():
    cmd = cs.build_command(req(custom_headers={"X-Test": "a b; c"}))
    assert cmd[0] == "/usr/bin/curl"
    assert "--resolve" in cmd and cmd[cmd.index("--resolve") + 1] == "app.local:80:127.0.0.1"
    assert cmd[cmd.index("-H") + 1] == "X-Test: a b; c"
    assert cmd[-2:] == ["--", "http://app.local:80/"]
    assert "--max-time" in cmd and cmd[cmd.index("--max-time") + 1] == "5"
    assert "--noproxy" in cmd and "-L" not in cmd and "-k" not in cmd


def test_command_without_resolve_ip_and_ipv6_brackets():
    assert "--resolve" not in cs.build_command(req(resolve_ip=None))
    cmd = cs.build_command(req(resolve_ip="::1", protocol="HTTPS", port=443))
    assert cmd[cmd.index("--resolve") + 1] == "app.local:443:[::1]"
    assert cmd[-1] == "https://app.local:443/"


# --- guard SSRF (di server, bukan UI) -------------------------------------------------------
def test_port_allowlist_blocks_internal_services():
    with pytest.raises(AppError) as e:
        cs.check_target(req(port=5432))
    assert e.value.code == "PORT_NOT_ALLOWED" and e.value.status == 400
    for ok in (80, 443, 8080, 8443, 8000):
        cs.check_target(req(port=ok))


def test_port_allowlist_configurable(monkeypatch):
    monkeypatch.setattr(cs.get_settings(), "curl_allowed_ports", "9000")
    cs.check_target(req(port=9000))
    with pytest.raises(AppError):
        cs.check_target(req(port=80))


@pytest.mark.parametrize("ip", ["169.254.169.254", "169.254.1.1", "fe80::1"])
def test_link_local_resolve_ip_blocked(ip):
    with pytest.raises(AppError) as e:
        cs.check_target(req(resolve_ip=ip))
    assert e.value.code == "TARGET_NOT_ALLOWED"


def test_link_local_literal_domain_blocked():
    with pytest.raises(AppError):
        cs.check_target(req(target_domain="169.254.169.254", resolve_ip=None))


# --- eksekusi & parsing ---------------------------------------------------------------------
def test_run_parses_status_latency_headers_ssl():
    with patch.object(cs.subprocess, "run", return_value=_proc(0, OK_OUT)) as run:
        r = cs.run_curl_test(req())
    assert not run.call_args.kwargs.get("shell") and run.call_args.kwargs["timeout"] == 15
    assert r["is_success"] is True and r["status_code"] == 200
    assert r["ttfb_ms"] == 12.3 and r["total_ms"] == 20.0
    assert r["headers"]["Server"] == "nginx" and r["headers"]["Set-Cookie"] == "a=1, b=2"
    assert r["ssl_status"].startswith("N/A")
    assert r["raw_output"].startswith("HTTP/1.1 200 OK") and r["error"] is None
    assert r["command"].startswith("/usr/bin/curl ") and "--resolve app.local:80:127.0.0.1" in r["command"]


def test_run_uses_last_header_block():
    out = "HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 301 Moved\r\nLocation: /x\r\n\r\n\n__CURL__301|0.1|0.1|0"
    with patch.object(cs.subprocess, "run", return_value=_proc(0, out)):
        r = cs.run_curl_test(req())
    assert r["status_code"] == 301 and r["headers"] == {"Location": "/x"}


def test_https_ok_reports_valid_ssl():
    out = "HTTP/2 200\r\n\r\n\n__CURL__200|0.1|0.2|0"
    with patch.object(cs.subprocess, "run", return_value=_proc(0, out)):
        r = cs.run_curl_test(req(protocol="HTTPS", port=443))
    assert r["ssl_status"].startswith("Valid")


@pytest.mark.parametrize(
    "rc,needle", [(6, "resolve"), (7, "ditolak"), (28, "Timeout"), (60, "Sertifikat"), (99, "kode 99")]
)
def test_curl_failure_is_friendly_and_not_exception(rc, needle):
    out = "\n__CURL__000|0.000000|0.000000|0"
    with patch.object(cs.subprocess, "run", return_value=_proc(rc, out, "curl: (x) boom")):
        r = cs.run_curl_test(req())
    assert r["is_success"] is False and r["status_code"] == 0
    assert needle.lower() in r["error"].lower()
    assert "boom" in r["raw_output"]


def test_https_failure_marks_ssl_status():
    out = "\n__CURL__000|0|0|0"
    with patch.object(cs.subprocess, "run", return_value=_proc(60, out, "cert problem")):
        r = cs.run_curl_test(req(protocol="HTTPS", port=443))
    assert r["ssl_status"].startswith("Gagal")


def test_subprocess_timeout_and_missing_binary_are_reported():
    with patch.object(cs.subprocess, "run", side_effect=subprocess.TimeoutExpired("curl", 15)):
        r = cs.run_curl_test(req())
    assert r["is_success"] is False and "batas waktu" in r["error"]
    with patch.object(cs.subprocess, "run", side_effect=FileNotFoundError("/usr/bin/curl")):
        r = cs.run_curl_test(req())
    assert r["is_success"] is False and "/usr/bin" not in r["error"]


def test_garbage_output_does_not_crash():
    with patch.object(cs.subprocess, "run", return_value=_proc(0, "no marker here")):
        r = cs.run_curl_test(req())
    assert r["is_success"] is False and r["status_code"] == 0
