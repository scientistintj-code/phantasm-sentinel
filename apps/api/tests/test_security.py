"""Target URL validation rejects non-public hosts."""

import ipaddress
import socket

import pytest

from sentinel.core.errors import InvalidTargetError
from sentinel.core.security import validate_target_url


@pytest.fixture(autouse=True)
def _block_network_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    def _blocked(host: str, *_args: object, **_kwargs: object) -> list[object]:
        raise AssertionError(f"unexpected DNS lookup for {host}")

    monkeypatch.setattr("sentinel.core.security.socket.getaddrinfo", _blocked)


def _install_dns(monkeypatch: pytest.MonkeyPatch, mapping: dict[str, list[str]]) -> None:
    def _resolve(
        host: str,
        _port: object = None,
        *_args: object,
        **_kwargs: object,
    ) -> list[tuple[int, int, int, str, tuple[str, int]]]:
        ips = mapping.get(host)
        if ips is None:
            raise socket.gaierror(socket.EAI_NONAME, "not found")
        results: list[tuple[int, int, int, str, tuple[str, int]]] = []
        for ip in ips:
            family = (
                socket.AF_INET6
                if isinstance(ipaddress.ip_address(ip), ipaddress.IPv6Address)
                else socket.AF_INET
            )
            results.append((family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (ip, 0)))
        return results

    monkeypatch.setattr("sentinel.core.security.socket.getaddrinfo", _resolve)


@pytest.mark.parametrize(
    ("url", "reason"),
    [
        ("ftp://8.8.8.8/", "scheme"),
        ("file:///etc/passwd", "scheme"),
        ("http://user:pass@8.8.8.8/a", "userinfo"),
        ("http://user@8.8.8.8/", "userinfo"),
        ("http://@8.8.8.8/", "userinfo"),
        ("http://127.0.0.1/", "loopback"),
        ("http://127.0.0.2:8080/admin", "loopback"),
        ("http://[::1]/", "loopback"),
        ("http://[::ffff:127.0.0.1]/", "loopback"),
        ("http://127.1/", "loopback"),
        ("http://2130706433/", "loopback"),
        ("http://0x7f000001/", "loopback"),
        ("http://0177.0.0.1/", "loopback"),
        ("http://localhost/a", "loopback"),
        ("http://10.1.2.3/", "private"),
        ("http://192.168.0.10/a", "private"),
        ("http://172.16.5.5/", "private"),
        ("http://[::ffff:10.0.0.1]/", "private"),
        ("http://100.64.0.1/", "private"),
        ("http://169.254.1.10/", "link-local"),
        ("http://[fe80::1]/", "link-local"),
        ("http://[fe80::1%25eth0]/", "link-local"),
        ("http://240.0.0.1/", "reserved"),
        ("http://0.0.0.0/", "reserved"),
        ("http://224.0.0.1/", "reserved"),
        ("http://169.254.169.254/latest/meta-data/", "cloud-metadata"),
        ("http://169.254.170.2/", "cloud-metadata"),
        ("http://168.63.129.16/", "cloud-metadata"),
        ("http://100.100.100.200/", "cloud-metadata"),
        ("http://[fd00:ec2::254]/", "cloud-metadata"),
        ("http://[::ffff:169.254.169.254]/", "cloud-metadata"),
        ("http://[::ffff:168.63.129.16]/", "cloud-metadata"),
        ("http://2852039166/", "cloud-metadata"),
        ("http://metadata.google.internal/", "cloud-metadata"),
        ("http://metadata.goog/computeMetadata/v1/", "cloud-metadata"),
        ("http://", "host"),
        ("http:///no-host", "host"),
        ("http://8.8.8.8:99999/", "host"),
        ("http://127.0.0.999/", "host"),
        ("http://example.com%40evil.com/", "host"),
        ("http://example%3Acom/", "host"),
        ("http://8.8.8.8/a b", "host"),
        (r"http://8.8.8.8\@127.0.0.1/", "host"),
        ("http://8.8.8.8:0/", "host"),
        ("http://[::g]/", "host"),
        ("http://bad_host.example/", "host"),
        ("http://8.8.8.8%00.example/", "host"),
    ],
)
def test_rejects_target(url: str, reason: str) -> None:
    with pytest.raises(InvalidTargetError) as caught:
        validate_target_url(url)

    assert caught.value.reason == reason


@pytest.mark.parametrize(
    ("host", "ips", "reason"),
    [
        ("loop.test", ["127.0.0.1"], "loopback"),
        ("private.test", ["10.2.3.4"], "private"),
        ("link.test", ["169.254.5.6"], "link-local"),
        ("reserved.test", ["240.1.2.3"], "reserved"),
        ("meta.test", ["169.254.169.254"], "cloud-metadata"),
        ("azure.test", ["168.63.129.16"], "cloud-metadata"),
        ("mixed.test", ["8.8.8.8", "10.0.0.1"], "private"),
        ("mapped-meta.test", ["::ffff:168.63.129.16"], "cloud-metadata"),
    ],
)
def test_rejects_resolved_address(
    monkeypatch: pytest.MonkeyPatch,
    host: str,
    ips: list[str],
    reason: str,
) -> None:
    _install_dns(monkeypatch, {host: ips})

    with pytest.raises(InvalidTargetError) as caught:
        validate_target_url(f"http://{host}/path")

    assert caught.value.reason == reason


def test_rejects_non_string_url() -> None:
    with pytest.raises(InvalidTargetError) as caught:
        validate_target_url(None)  # type: ignore[arg-type]

    assert caught.value.reason == "host"


def test_rejects_empty_dns_result(monkeypatch: pytest.MonkeyPatch) -> None:
    def _resolve(
        _host: str,
        _port: object = None,
        *_args: object,
        **_kwargs: object,
    ) -> list[object]:
        return []

    monkeypatch.setattr("sentinel.core.security.socket.getaddrinfo", _resolve)

    with pytest.raises(InvalidTargetError) as caught:
        validate_target_url("http://empty.test/")

    assert caught.value.reason == "unresolved"


def test_rejects_unresolved_host(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_dns(monkeypatch, {})

    with pytest.raises(InvalidTargetError) as caught:
        validate_target_url("http://missing.test/")

    assert caught.value.reason == "unresolved"


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("http://8.8.8.8", "http://8.8.8.8/"),
        ("http://8.8.8.8:80/a", "http://8.8.8.8/a"),
        ("https://1.1.1.1:443/a?b=1#frag", "https://1.1.1.1/a?b=1"),
        ("http://8.8.8.8:8080/a", "http://8.8.8.8:8080/a"),
        ("https://[2606:4700:4700::1111]/a", "https://[2606:4700:4700::1111]/a"),
        ("http://[::ffff:8.8.8.8]/a", "http://8.8.8.8/a"),
        ("http://010.010.010.010/", "http://8.8.8.8/"),
        ("http://8.8.8/", "http://8.8.0.8/"),
    ],
)
def test_normalizes_public_literals(url: str, expected: str) -> None:
    assert validate_target_url(url) == expected


def test_normalizes_public_hostname(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    def _resolve(
        host: str,
        _port: object = None,
        *_args: object,
        **_kwargs: object,
    ) -> list[tuple[int, int, int, str, tuple[str, int]]]:
        seen.append(host)
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", 0))]

    monkeypatch.setattr("sentinel.core.security.socket.getaddrinfo", _resolve)

    assert validate_target_url("HTTPS://Example.COM.:443/a?b=1#frag") == (
        "https://example.com/a?b=1"
    )
    assert seen == ["example.com"]


def test_resolves_idna_hostname(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    def _resolve(
        host: str,
        _port: object = None,
        *_args: object,
        **_kwargs: object,
    ) -> list[tuple[int, int, int, str, tuple[str, int]]]:
        seen.append(host)
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", 0))]

    monkeypatch.setattr("sentinel.core.security.socket.getaddrinfo", _resolve)
    expected_host = "bücher.example".encode("idna").decode("ascii")

    assert validate_target_url("http://Bücher.example/a") == f"http://{expected_host}/a"
    assert seen == [expected_host]
