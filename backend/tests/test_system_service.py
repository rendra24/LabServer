import subprocess
from unittest.mock import patch

from app.services import system_service as ss


def _proc(rc=0, out="", err=""):
    return subprocess.CompletedProcess(args=[], returncode=rc, stdout=out, stderr=err)


def test_nginx_test_success_uses_fixed_argv_without_shell():
    with patch.object(ss.subprocess, "run", return_value=_proc(0, "", "syntax is ok")) as run:
        r = ss.run_nginx_test()
    args, kwargs = run.call_args
    assert args[0] == ["sudo", "-n", "/usr/sbin/nginx", "-t"]
    assert not kwargs.get("shell") and kwargs["timeout"] == 10
    assert kwargs["capture_output"] is True and kwargs["text"] is True
    assert r["is_success"] is True and r["stderr"] == "syntax is ok" and r["returncode"] == 0


def test_nginx_test_failure_keeps_stderr():
    with patch.object(ss.subprocess, "run", return_value=_proc(1, "", "[emerg] unknown directive")):
        r = ss.run_nginx_test()
    assert r["is_success"] is False and "unknown directive" in r["stderr"]


def test_nginx_test_timeout_is_failure_with_generic_message():
    with patch.object(ss.subprocess, "run", side_effect=subprocess.TimeoutExpired("x", 10)):
        r = ss.run_nginx_test()
    assert r["is_success"] is False and "batas waktu" in r["stderr"]


def test_nginx_test_missing_binary_does_not_leak_path():
    with patch.object(ss.subprocess, "run", side_effect=FileNotFoundError("/usr/sbin/nginx")):
        r = ss.run_nginx_test()
    assert r["is_success"] is False and "/usr/sbin" not in r["stderr"]


def test_reload_blocked_when_syntax_invalid_and_never_calls_systemctl():
    with patch.object(ss.subprocess, "run", return_value=_proc(1, "", "[emerg] bad")) as run:
        msg, ok = ss.reload_nginx_safe()
    assert ok is False and msg.startswith(ss.SYNTAX_INVALID) and "[emerg] bad" in msg
    assert run.call_count == 1  # hanya nginx -t


def test_reload_runs_systemctl_only_after_valid_test():
    calls = [_proc(0, "", "ok"), _proc(0)]
    with patch.object(ss.subprocess, "run", side_effect=calls) as run:
        msg, ok = ss.reload_nginx_safe()
    assert ok is True and "berhasil" in msg.lower()
    assert [c.args[0] for c in run.call_args_list] == [
        ["sudo", "-n", "/usr/sbin/nginx", "-t"],
        ["sudo", "-n", "/bin/systemctl", "reload", "nginx"],
    ]


def test_reload_command_failure_is_reported_not_as_syntax_error():
    calls = [_proc(0, "", "ok"), _proc(1, "", "Failed to reload nginx.service")]
    with patch.object(ss.subprocess, "run", side_effect=calls):
        msg, ok = ss.reload_nginx_safe()
    assert ok is False and not msg.startswith(ss.SYNTAX_INVALID)


def test_reload_blocked_on_invalid_syntax_doc_selfcheck():
    with patch("app.services.system_service.run_nginx_test") as mock_test:
        mock_test.return_value = {"is_success": False, "stderr": "syntax error", "stdout": ""}
        result, success = ss.reload_nginx_safe()
        assert success is False
        assert "Sintaks tidak valid" in result


