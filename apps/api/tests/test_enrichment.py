"""Passive enrichment: pinned public addresses and partial results."""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime
from typing import cast

import dns.message
import dns.name
import dns.rdata
import dns.rdataclass
import dns.rdatatype
import dns.resolver
import httpcore
import httpx
import pytest
from pydantic import ValidationError

from sentinel.core.errors import InvalidTargetError
from sentinel.pipeline.enrichment import (
    Indicator,
    InfraProfile,
    _DnspythonLookup,
    _PinnedBackend,
    _SafeTransport,
    enrich,
)

_DER = b"sentinel-test-certificate"
_FINGERPRINT = hashlib.sha256(_DER).hexdigest()
_BOOTSTRAP = {
    "services": [
        [["net"], ["https://rdap.example/net/"]],
        [["example"], ["https://rdap.example/rdap/"]],
    ]
}
_RDAP = {
    "events": [
        {"eventAction": "expiration", "eventDate": "2030-01-02T03:04:05Z"},
        {"eventAction": "registration", "eventDate": "2020-01-02T03:04:05Z"},
    ],
    "nameservers": [{"ldhName": "NS1.Example.NET"}, {"objectClassName": "nameserver"}],
    "entities": [
        {
            "roles": ["abuse"],
            "vcardArray": ["vcard", [["fn", {}, "text", "Abuse Desk"]]],
        },
        {
            "roles": ["registrar"],
            "vcardArray": [
                "vcard",
                [
                    ["version", {}, "text", "4.0"],
                    ["fn", {}, "text", "Example Registrar"],
                ],
            ],
        },
    ],
}


def _record(rdtype: str, text: str) -> dns.rdata.Rdata:
    return dns.rdata.from_text(dns.rdataclass.IN, dns.rdatatype.from_text(rdtype), text)


def _a(*addresses: str) -> tuple[dns.rdata.Rdata, ...]:
    return tuple(_record("A", address) for address in addresses)


def _aaaa(*addresses: str) -> tuple[dns.rdata.Rdata, ...]:
    return tuple(_record("AAAA", address) for address in addresses)


class _Table:
    def __init__(self, rows: Mapping[tuple[str, str], Sequence[object] | Exception]) -> None:
        self.rows = rows
        self.calls: list[tuple[str, str]] = []

    async def records(self, host: str, rdtype: str) -> Sequence[object]:
        self.calls.append((host, rdtype))
        value = self.rows.get((host, rdtype), ())
        if isinstance(value, Exception):
            raise value
        return value


def _lookup(
    hosts: tuple[str, ...] = (),
    extra: Mapping[tuple[str, str], Sequence[object] | Exception] | None = None,
) -> _Table:
    rows: dict[tuple[str, str], Sequence[object] | Exception] = {}
    for host in (*hosts, "data.iana.org", "rdap.example"):
        rows[(host, "A")] = _a("1.1.1.1")
    if extra:
        rows.update(extra)
    return _Table(rows)


class _Tls:
    def __init__(self, result: tuple[Mapping[str, object], bytes] | Exception) -> None:
        self.result = result
        self.calls: list[tuple[str, str]] = []

    async def __call__(self, host: str, ip: str) -> tuple[Mapping[str, object], bytes]:
        self.calls.append((host, ip))
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def _cert() -> tuple[Mapping[str, object], bytes]:
    decoded: dict[str, object] = {
        "subject": ((("commonName", "shop.example"),),),
        "issuer": (
            (("commonName", "Test CA"),),
            (("organizationName", "Labs"),),
        ),
        "subjectAltName": (("DNS", "shop.example"), ("DNS", "www.shop.example")),
        "notBefore": "Jan  1 00:00:00 2024 GMT",
        "notAfter": "Dec 31 23:59:59 2025 GMT",
    }
    return decoded, _DER


def _client(
    handler: httpx.MockTransport | Callable[[httpx.Request], httpx.Response],
) -> httpx.AsyncClient:
    if isinstance(handler, httpx.MockTransport):
        transport = handler
    else:
        transport = httpx.MockTransport(handler)
    return httpx.AsyncClient(transport=transport, trust_env=False, follow_redirects=False)


def _routes(
    extra: Callable[[httpx.Request], httpx.Response | None],
) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        host = request.url.host
        if host in {"data.iana.org", "rdap.example"}:
            override = extra(request)
            if override is not None:
                return override
            if host == "data.iana.org":
                return httpx.Response(200, json=_BOOTSTRAP)
            return httpx.Response(200, json=_RDAP)
        override = extra(request)
        if override is None:
            raise AssertionError(str(request.url))
        return override

    return handler


class _Recorder(httpcore.AsyncNetworkBackend):
    def __init__(self) -> None:
        self.hosts: list[str] = []

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,  # noqa: ASYNC109
        local_address: str | None = None,
        socket_options: object = None,
    ) -> httpcore.AsyncNetworkStream:
        del timeout, local_address, socket_options
        self.hosts.append(host)
        raise httpcore.ConnectError("stopped")

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,  # noqa: ASYNC109
        socket_options: object = None,
    ) -> httpcore.AsyncNetworkStream:
        del timeout, socket_options
        raise httpcore.ConnectError(path)

    async def sleep(self, seconds: float) -> None:
        return None


def _answer(name: str, rdtype: str, rdata: str) -> dns.resolver.Answer:
    message = dns.message.from_text(
        "\n".join(
            (
                "id 1",
                "opcode QUERY",
                "rcode NOERROR",
                "flags QR AA RD",
                ";QUESTION",
                f"{name}. IN {rdtype}",
                ";ANSWER",
                f"{name}. 60 IN {rdtype} {rdata}",
                ";AUTHORITY",
                ";ADDITIONAL",
            )
        )
    )
    return dns.resolver.Answer(
        dns.name.from_text(name),
        dns.rdatatype.from_text(rdtype),
        dns.rdataclass.IN,
        message,
    )


class _StubResolver:
    def __init__(self, answer: dns.resolver.Answer | None = None) -> None:
        self.answer = answer
        self.calls: list[tuple[object, object, dict[str, object]]] = []

    async def resolve(
        self,
        qname: object,
        rdtype: object = "A",
        **kwargs: object,
    ) -> dns.resolver.Answer:
        self.calls.append((qname, rdtype, kwargs))
        if self.answer is None:
            raise dns.resolver.NXDOMAIN
        return self.answer


async def test_enrich_collects_public_facts_and_indicators() -> None:
    seen: list[str] = []
    lookup = _lookup(
        ("shop.example", "pay.example"),
        {
            ("shop.example", "A"): _a("1.1.1.1", "8.8.8.8"),
            ("shop.example", "NS"): (_record("NS", "ns0.example.net."),),
            ("shop.example", "MX"): (_record("MX", "10 mx.example.net."),),
            ("shop.example", "TXT"): (_record("TXT", '"v=spf1 -all"'),),
        },
    )
    tls = _Tls(_cert())

    def target(request: httpx.Request) -> httpx.Response | None:
        if request.url.host == "shop.example":
            seen.append(request.url.host)
            assert request.method == "HEAD"
            assert request.url.path == "/shop"
            return httpx.Response(302, headers={"location": "https://pay.example/checkout"})
        if request.url.host == "pay.example":
            seen.append(request.url.host)
            assert request.method == "HEAD"
            return httpx.Response(
                200,
                headers={
                    "server": "edge",
                    "strict-transport-security": "max-age=60",
                    "x-frame-options": "DENY",
                    "x-unrelated": "ignore",
                },
            )
        return None

    async with _client(_routes(target)) as client:
        profile = await enrich(
            "https://Shop.Example/shop",
            lookup=lookup,
            client=client,
            open_tls=tls,
        )

    assert isinstance(profile, InfraProfile)
    assert profile.a == ("1.1.1.1", "8.8.8.8")
    assert profile.aaaa is None
    assert profile.ns == ("ns0.example.net",)
    assert profile.mx == ("10 mx.example.net",)
    assert profile.txt == ("v=spf1 -all",)
    assert profile.issuer == "commonName=Test CA, organizationName=Labs"
    assert profile.subject_cn == "shop.example"
    assert profile.sans == ("shop.example", "www.shop.example")
    assert profile.not_before == datetime(2024, 1, 1, tzinfo=UTC)
    assert profile.not_after == datetime(2025, 12, 31, 23, 59, 59, tzinfo=UTC)
    assert profile.fingerprint_sha256 == _FINGERPRINT
    assert profile.status == 200
    assert profile.server == "edge"
    assert profile.security_headers == ("strict-transport-security", "x-frame-options")
    assert profile.redirect_hosts == ("shop.example", "pay.example")
    assert profile.registrar == "Example Registrar"
    assert profile.created == datetime(2020, 1, 2, 3, 4, 5, tzinfo=UTC)
    assert profile.nameservers == ("ns1.example.net",)
    assert profile.errors == ()
    assert tls.calls == [("shop.example", "1.1.1.1")]
    assert seen == ["shop.example", "pay.example"]
    assert [(item.kind, item.value, item.source) for item in profile.indicators] == [
        ("domain", "shop.example", "enrichment"),
        ("ip", "1.1.1.1", "enrichment"),
        ("ip", "8.8.8.8", "enrichment"),
        ("ns", "ns0.example.net", "enrichment"),
        ("ns", "ns1.example.net", "enrichment"),
        ("cert_fingerprint", _FINGERPRINT, "enrichment"),
        ("registrar", "Example Registrar", "enrichment"),
    ]
    with pytest.raises(ValidationError):
        profile.server = "mutated"
    assert Indicator(kind="ip", value="1.1.1.1").source == "enrichment"


async def test_partial_failures_do_not_raise() -> None:
    lookup = _lookup(
        ("shop.example",),
        {("shop.example", "TXT"): dns.exception.Timeout()},
    )
    tls = _Tls(TimeoutError("handshake"))

    def target(request: httpx.Request) -> httpx.Response | None:
        if request.url.host == "shop.example":
            return httpx.Response(204, headers={"server": "origin"})
        if request.url.host == "rdap.example":
            return httpx.Response(404, json={"error": "missing"})
        return None

    async with _client(_routes(target)) as client:
        profile = await enrich("https://shop.example/", lookup=lookup, client=client, open_tls=tls)

    assert profile.status == 204
    assert profile.server == "origin"
    assert profile.a == ("1.1.1.1",)
    assert profile.txt is None
    assert profile.fingerprint_sha256 is None
    assert profile.registrar is None
    assert profile.nameservers is None
    assert "dns: TXT Timeout" in profile.errors
    assert "tls: TimeoutError" in profile.errors
    assert "registration: HTTP 404" in profile.errors
    assert ("domain", "shop.example") in {(item.kind, item.value) for item in profile.indicators}
    assert "cert_fingerprint" not in {item.kind for item in profile.indicators}


async def test_mixed_private_address_is_not_contacted() -> None:
    called: list[str] = []
    lookup = _lookup(
        (),
        {
            ("shop.example", "A"): _a("1.1.1.1", "10.9.8.7"),
            ("shop.example", "NS"): (_record("NS", "ns0.example.net."),),
        },
    )
    tls = _Tls(_cert())

    def target(request: httpx.Request) -> httpx.Response | None:
        called.append(request.url.host)
        if request.url.host == "shop.example":
            raise AssertionError("connected to a mixed-address host")
        return None

    async with _client(_routes(target)) as client:
        profile = await enrich("https://shop.example/", lookup=lookup, client=client, open_tls=tls)

    assert profile.a is None
    assert profile.status is None
    assert tls.calls == []
    assert "shop.example" not in called
    assert "dns: private" in profile.errors
    assert profile.ns == ("ns0.example.net",)
    assert ("ip", "1.1.1.1") not in {(item.kind, item.value) for item in profile.indicators}
    assert ("ns", "ns0.example.net") in {(item.kind, item.value) for item in profile.indicators}
    assert profile.registrar == "Example Registrar"


async def test_redirect_to_metadata_is_not_fetched() -> None:
    called: list[str] = []

    def target(request: httpx.Request) -> httpx.Response | None:
        called.append(request.url.host)
        if request.url.host == "shop.example":
            return httpx.Response(
                302, headers={"location": "http://169.254.169.254/latest/meta-data"}
            )
        return None

    async with _client(_routes(target)) as client:
        profile = await enrich(
            "https://shop.example/",
            lookup=_lookup(("shop.example",)),
            client=client,
            open_tls=_Tls(_cert()),
        )

    assert "169.254.169.254" not in called
    assert profile.status == 302
    assert profile.redirect_hosts == ("shop.example",)
    assert any("metadata" in error.lower() for error in profile.errors)


async def test_head_follows_at_most_three_redirects() -> None:
    called: list[str] = []
    chain = {
        "a.example": "https://b.example/",
        "b.example": "https://c.example/",
        "c.example": "https://d.example/",
        "d.example": "https://e.example/",
    }

    def target(request: httpx.Request) -> httpx.Response | None:
        location = chain.get(request.url.host)
        if location is None:
            return None
        called.append(request.url.host)
        return httpx.Response(302, headers={"location": location, "server": request.url.host})

    async with _client(_routes(target)) as client:
        profile = await enrich(
            "https://a.example/start",
            lookup=_lookup(("a.example", "b.example", "c.example", "d.example")),
            client=client,
            open_tls=_Tls(_cert()),
        )

    assert called == ["a.example", "b.example", "c.example", "d.example"]
    assert profile.redirect_hosts == ("a.example", "b.example", "c.example", "d.example")
    assert profile.status == 302
    assert profile.server == "d.example"


@pytest.mark.parametrize(
    "host",
    [
        "127.0.0.1",
        "10.1.2.3",
        "172.16.0.1",
        "192.168.0.1",
        "169.254.1.1",
        "169.254.169.254",
        "168.63.129.16",
        "100.100.100.200",
        "::1",
        "fd00:ec2::254",
    ],
)
async def test_pinned_backend_rejects_non_public_literals(host: str) -> None:
    inner = _Recorder()
    backend = _PinnedBackend(_Table({}), inner)
    with pytest.raises(InvalidTargetError):
        await backend.connect_tcp(host, 443)
    assert inner.hosts == []


async def test_pinned_backend_dials_the_resolved_ip() -> None:
    lookup = _Table(
        {
            ("example.com", "A"): _a("1.1.1.1"),
            ("example.com", "AAAA"): _aaaa("2001:4860:4860::8888"),
        }
    )
    inner = _Recorder()
    backend = _PinnedBackend(lookup, inner)
    with pytest.raises(httpcore.ConnectError):
        await backend.connect_tcp("example.com", 443)
    assert inner.hosts == ["1.1.1.1"]

    blocked = _Recorder()
    poisoned = _Table({("example.com", "A"): _a("1.1.1.1", "10.9.8.7")})
    with pytest.raises(InvalidTargetError):
        await _PinnedBackend(poisoned, blocked).connect_tcp("example.com", 443)
    assert blocked.hosts == []
    with pytest.raises(InvalidTargetError):
        await _PinnedBackend(_Table({}), inner).connect_unix_socket("sentinel.sock")


async def test_safe_client_pins_its_network_backend() -> None:
    client = _safe_client_for_test()
    transport = client._transport
    assert isinstance(transport, _SafeTransport)
    backend = transport._pool._network_backend
    assert isinstance(backend, _PinnedBackend)
    await client.aclose()


def _safe_client_for_test() -> httpx.AsyncClient:
    from sentinel.pipeline.enrichment import _safe_client

    return _safe_client(_Table({}))


@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com/",
        "http://user:pass@example.com/",
        "http://127.0.0.1/",
        "http://localhost/admin",
        "http://169.254.169.254/",
        "http://metadata.google.internal/",
        "http://10.0.0.1/x",
        "",
    ],
)
async def test_invalid_target_raises_before_lookup(url: str) -> None:
    lookup = _Table({})
    with pytest.raises(InvalidTargetError):
        await enrich(url, lookup=lookup, open_tls=_Tls(_cert()))
    assert lookup.calls == []


async def test_ip_literal_skips_domain_rdap() -> None:
    called: list[str] = []
    tls = _Tls(_cert())

    def handler(request: httpx.Request) -> httpx.Response:
        called.append(request.url.host)
        assert request.method == "HEAD"
        return httpx.Response(200, headers={"server": "literal"})

    async with _client(handler) as client:
        profile = await enrich(
            "https://1.1.1.1/item",
            lookup=_Table({}),
            client=client,
            open_tls=tls,
        )

    assert called == ["1.1.1.1"]
    assert profile.a == ("1.1.1.1",)
    assert profile.registrar is None
    assert profile.errors == ()
    assert tls.calls == [("1.1.1.1", "1.1.1.1")]
    assert [item.kind for item in profile.indicators] == ["ip", "cert_fingerprint"]


async def test_rdap_tolerates_missing_fields() -> None:
    def target(request: httpx.Request) -> httpx.Response | None:
        if request.url.host == "rdap.example":
            return httpx.Response(200, json={"objectClassName": "domain"})
        if request.url.host == "shop.example":
            return httpx.Response(200)
        return None

    async with _client(_routes(target)) as client:
        profile = await enrich(
            "https://shop.example",
            lookup=_lookup(("shop.example",)),
            client=client,
            open_tls=_Tls(_cert()),
        )

    assert profile.registrar is None
    assert profile.created is None
    assert profile.nameservers is None
    assert profile.errors == ()
    assert "registrar" not in {item.kind for item in profile.indicators}


async def test_dnspython_lookup_uses_async_resolver_limits() -> None:
    answer = _answer("example.com", "A", "1.1.1.1")
    stub = _StubResolver(answer)
    lookup = _DnspythonLookup(cast(dns.asyncresolver.Resolver, stub))
    rows = await lookup.records("example.com", "A")
    assert len(rows) == 1
    assert getattr(rows[0], "address", None) == "1.1.1.1"
    _qname, rdtype, kwargs = stub.calls[0]
    assert rdtype == "A"
    assert kwargs["lifetime"] == 3.0
    assert kwargs["search"] is False
    assert kwargs["raise_on_no_answer"] is False

    empty = _DnspythonLookup(cast(dns.asyncresolver.Resolver, _StubResolver()))
    with pytest.raises(dns.resolver.NXDOMAIN):
        await empty.records("missing.example", "AAAA")


def test_bootstrap_redirect_to_loopback_is_rejected() -> None:
    from sentinel.pipeline.enrichment import _screen_target

    with pytest.raises(InvalidTargetError):
        _screen_target("http://127.0.0.1/rdap/dns.json")
