"""Passive infrastructure collection for one validated target URL.

DNS uses dnspython's async resolver. TLS is a single handshake on port 443.
HTTP is one HEAD, plus at most three redirects. Registration is an IANA RDAP
bootstrap followed by one domain query. Each lookup records a failure on
``InfraProfile.errors`` instead of raising. Connections resolve first, reject
non-public addresses with ``sentinel.core.security``, then dial the pinned IP
while the URL host stays on the Host header and the TLS SNI.
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import ipaddress
import ssl
from collections.abc import AsyncIterable, AsyncIterator, Iterable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Literal, Protocol, cast
from urllib.parse import unquote, urljoin, urlsplit

import dns.asyncresolver
import dns.exception
import dns.name
import dns.rdtypes.ANY.MX
import dns.rdtypes.ANY.NS
import dns.rdtypes.ANY.TXT
import dns.rdtypes.IN.A
import dns.rdtypes.IN.AAAA
import dns.resolver
import httpcore
import httpx
from pydantic import BaseModel, ConfigDict

from sentinel.core.errors import InvalidTargetError
from sentinel.core.security import (
    _HOSTNAME_RE,
    _LOOPBACK_NAMES,
    _METADATA_NAMES,
    _idna,
    _literal_address,
    _reject,
    _reject_address,
)

_TIMEOUT_SECONDS = 3.0
_TLS_PORT = 443
_MAX_REDIRECTS = 3
_RDAP_BOOTSTRAP = "https://data.iana.org/rdap/dns.json"
_REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_SECURITY_HEADERS = (
    "strict-transport-security",
    "content-security-policy",
    "content-security-policy-report-only",
    "x-content-type-options",
    "x-frame-options",
    "referrer-policy",
    "permissions-policy",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
    "cross-origin-embedder-policy",
)
_CERT_TIME = "%b %d %H:%M:%S %Y %Z"
_Kind = Literal["ip", "ns", "cert_fingerprint", "registrar", "domain"]

_IP = ipaddress.IPv4Address | ipaddress.IPv6Address


class Indicator(BaseModel):
    """One enrichment candidate. ``source`` is always ``enrichment``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: _Kind
    value: str
    source: Literal["enrichment"] = "enrichment"


class InfraProfile(BaseModel):
    """Passive facts for one target. Every fact is optional.

    ``ns``, ``mx``, and ``txt`` come from DNS. ``nameservers``, ``registrar``,
    and ``created`` come from RDAP. ``security_headers`` lists the known
    headers that were present on the final HEAD response.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    a: tuple[str, ...] | None = None
    aaaa: tuple[str, ...] | None = None
    ns: tuple[str, ...] | None = None
    mx: tuple[str, ...] | None = None
    txt: tuple[str, ...] | None = None
    issuer: str | None = None
    subject_cn: str | None = None
    sans: tuple[str, ...] | None = None
    not_before: datetime | None = None
    not_after: datetime | None = None
    fingerprint_sha256: str | None = None
    status: int | None = None
    server: str | None = None
    security_headers: tuple[str, ...] | None = None
    redirect_hosts: tuple[str, ...] | None = None
    registrar: str | None = None
    created: datetime | None = None
    nameservers: tuple[str, ...] | None = None
    errors: tuple[str, ...] = ()
    indicators: tuple[Indicator, ...] = ()


class _RecordLookup(Protocol):
    async def records(self, host: str, rdtype: str) -> Sequence[object]: ...


class _TlsOpen(Protocol):
    async def __call__(self, host: str, ip: str) -> tuple[Mapping[str, object], bytes]: ...


class _AddressSet:
    def __init__(
        self,
        a: tuple[str, ...] | None,
        aaaa: tuple[str, ...] | None,
        ips: tuple[str, ...],
        errors: tuple[str, ...],
        block_reason: str | None,
    ) -> None:
        self.a = a
        self.aaaa = aaaa
        self.ips = ips
        self.errors = errors
        self.block_reason = block_reason


class _DnsFacts:
    def __init__(
        self,
        a: tuple[str, ...] | None = None,
        aaaa: tuple[str, ...] | None = None,
        ns: tuple[str, ...] | None = None,
        mx: tuple[str, ...] | None = None,
        txt: tuple[str, ...] | None = None,
        connect_ip: str | None = None,
        errors: tuple[str, ...] = (),
    ) -> None:
        self.a = a
        self.aaaa = aaaa
        self.ns = ns
        self.mx = mx
        self.txt = txt
        self.connect_ip = connect_ip
        self.errors = errors


class _HttpFacts:
    def __init__(
        self,
        status: int | None = None,
        server: str | None = None,
        security_headers: tuple[str, ...] | None = None,
        redirect_hosts: tuple[str, ...] | None = None,
        errors: tuple[str, ...] = (),
    ) -> None:
        self.status = status
        self.server = server
        self.security_headers = security_headers
        self.redirect_hosts = redirect_hosts
        self.errors = errors


class _Registration:
    def __init__(
        self,
        registrar: str | None = None,
        created: datetime | None = None,
        nameservers: tuple[str, ...] | None = None,
        errors: tuple[str, ...] = (),
    ) -> None:
        self.registrar = registrar
        self.created = created
        self.nameservers = nameservers
        self.errors = errors


def _dedupe(items: Iterable[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(item for item in items if item != ""))


def _present(values: Iterable[str]) -> tuple[str, ...] | None:
    unique = _dedupe(values)
    return unique or None


def _resolver() -> dns.asyncresolver.Resolver:
    resolver = dns.asyncresolver.Resolver()
    resolver.lifetime = _TIMEOUT_SECONDS
    resolver.timeout = _TIMEOUT_SECONDS
    return resolver


class _DnspythonLookup:
    """Async dnspython queries with a 3 second lifetime and search disabled."""

    def __init__(self, resolver: dns.asyncresolver.Resolver | None = None) -> None:
        self._resolver = _resolver() if resolver is None else resolver

    async def records(self, host: str, rdtype: str) -> Sequence[object]:
        try:
            answer = await self._resolver.resolve(
                host,
                rdtype,
                lifetime=_TIMEOUT_SECONDS,
                search=False,
                raise_on_no_answer=False,
            )
        except dns.resolver.NoAnswer:
            return ()
        rrset = answer.rrset
        if rrset is None:
            return ()
        return tuple(cast(Iterable[object], rrset))


class _CachingLookup:
    """One answer per name and type for a single enrichment call."""

    def __init__(self, inner: _RecordLookup) -> None:
        self._inner = inner
        self._rows: dict[tuple[str, str], tuple[object, ...] | Exception] = {}

    async def records(self, host: str, rdtype: str) -> Sequence[object]:
        key = (host, rdtype)
        cached = self._rows.get(key)
        if isinstance(cached, Exception):
            raise cached
        if cached is not None:
            return cached
        try:
            rows = tuple(await self._inner.records(host, rdtype))
        except Exception as exc:
            self._rows[key] = exc
            raise
        self._rows[key] = rows
        return rows


def _screen_host(host: str) -> tuple[str, _IP | None]:
    """Apply the security hostname policy without a blocking DNS lookup."""
    literal = _literal_address(host)
    if literal is not None:
        _reject_address(literal)
        return str(literal), literal
    ascii_host = _idna(host)
    if ascii_host in _LOOPBACK_NAMES:
        _reject("loopback")
    if ascii_host in _METADATA_NAMES:
        _reject("cloud-metadata")
    if _HOSTNAME_RE.fullmatch(ascii_host) is None:
        _reject("host")
    return ascii_host, None


def _format_url(scheme: str, host: str, port: int | None, path: str, query: str) -> str:
    if (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        port = None
    host_part = f"[{host}]" if ":" in host else host
    netloc = f"{host_part}:{port}" if port is not None else host_part
    suffix = path or "/"
    if query:
        suffix = f"{suffix}?{query}"
    return f"{scheme}://{netloc}{suffix}"


def _screen_target(url: str) -> tuple[str, str, _IP | None]:
    """Validate URL syntax and literal addresses. Hostnames are not resolved."""
    if not isinstance(url, str) or url == "":
        _reject("host", "URL must be a non-empty string")
    if any(char.isspace() or ord(char) < 32 or ord(char) == 127 for char in url):
        _reject("host", "URL must not contain whitespace or control characters")
    if "\\" in url:
        _reject("host", "URL must not contain backslashes")
    try:
        parsed = urlsplit(url)
    except ValueError as exc:
        _reject("host", "URL could not be parsed", cause=exc)

    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        _reject("scheme")
    if parsed.username is not None or parsed.password is not None:
        _reject("userinfo")
    if parsed.hostname is None:
        _reject("host")

    host = unquote(parsed.hostname)
    if host.endswith("."):
        host = host[:-1]
    if host == "" or any(char in host for char in "@/\\") or any(char.isspace() for char in host):
        _reject("host")
    if any(ord(char) < 32 or ord(char) == 127 for char in host):
        _reject("host")
    try:
        port = parsed.port
    except ValueError as exc:
        _reject("host", "URL port is invalid", cause=exc)
    if port == 0:
        _reject("host", "URL port is invalid")

    ascii_host, literal = _screen_host(host)
    return _format_url(scheme, ascii_host, port, parsed.path, parsed.query), ascii_host, literal


def _unwrap(address: _IP) -> _IP:
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return address.ipv4_mapped
    return address


def _checked_ip(raw: str) -> str | None:
    try:
        parsed = _unwrap(ipaddress.ip_address(raw))
    except ValueError:
        return None
    _reject_address(parsed)
    return str(parsed)


def _name_text(name: dns.name.Name) -> str:
    return name.to_text(omit_final_dot=True).lower()


def _format_record(item: object) -> str | None:
    if isinstance(item, dns.rdtypes.ANY.NS.NS):
        return _name_text(item.target)
    if isinstance(item, dns.rdtypes.ANY.MX.MX):
        return f"{item.preference} {_name_text(item.exchange)}"
    if isinstance(item, dns.rdtypes.ANY.TXT.TXT):
        parts = [piece.decode("utf-8", errors="replace") for piece in item.strings]
        text = "".join(parts).strip()
        return text or None
    return None


async def _query(
    lookup: _RecordLookup,
    host: str,
    rdtype: str,
) -> tuple[tuple[object, ...] | None, str | None]:
    try:
        return tuple(await lookup.records(host, rdtype)), None
    except dns.resolver.NXDOMAIN:
        return None, "dns: NXDOMAIN"
    except dns.resolver.NoAnswer:
        return (), None
    except Exception as exc:
        return None, f"dns: {rdtype} {exc.__class__.__name__}"


async def _walk_ips(host: str, lookup: _RecordLookup) -> _AddressSet:
    errors: list[str] = []
    blocked: list[str] = []
    found: dict[str, list[str]] = {"A": [], "AAAA": []}
    for rdtype in ("A", "AAAA"):
        rows, error = await _query(lookup, host, rdtype)
        if error == "dns: NXDOMAIN":
            return _AddressSet(None, None, (), ("dns: NXDOMAIN",), None)
        if error is not None:
            errors.append(error)
            continue
        if rows is None:
            continue
        bucket = found[rdtype]
        for item in rows:
            raw = _ip_text(item)
            if raw is None:
                continue
            try:
                checked = _checked_ip(raw)
            except InvalidTargetError as exc:
                blocked.append(exc.reason)
                continue
            if checked is not None:
                bucket.append(checked)
    if blocked:
        reasons = tuple(f"dns: {reason}" for reason in dict.fromkeys(blocked))
        return _AddressSet(None, None, (), reasons, blocked[0])
    a = _present(found["A"])
    aaaa = _present(found["AAAA"])
    ips = _dedupe((*(a or ()), *(aaaa or ())))
    if not ips and not errors:
        errors.append("dns: unresolved")
    return _AddressSet(a, aaaa, ips, tuple(errors), None)


def _ip_text(item: object) -> str | None:
    if isinstance(item, dns.rdtypes.IN.A.A | dns.rdtypes.IN.AAAA.AAAA):
        return str(item.address)
    return None


async def _choose_ip(host: str, literal: _IP | None, lookup: _RecordLookup) -> str:
    if literal is not None:
        return str(literal)
    walk = await _walk_ips(host, lookup)
    if walk.block_reason is not None:
        _reject(walk.block_reason)
    if walk.ips:
        return walk.ips[0]
    message = walk.errors[0] if walk.errors else None
    _reject("unresolved", message)


async def _load_names(
    host: str,
    lookup: _RecordLookup,
    rdtype: str,
) -> tuple[tuple[str, ...] | None, str | None]:
    rows, error = await _query(lookup, host, rdtype)
    if error is not None or rows is None:
        return None, error
    values: list[str] = []
    for item in rows:
        text = _format_record(item)
        if text is not None:
            values.append(text)
    return _present(values), None


async def _load_dns(host: str, literal: _IP | None, lookup: _RecordLookup) -> _DnsFacts:
    if literal is not None:
        text = str(literal)
        if isinstance(literal, ipaddress.IPv6Address):
            return _DnsFacts(aaaa=(text,), connect_ip=text)
        return _DnsFacts(a=(text,), connect_ip=text)

    walk = await _walk_ips(host, lookup)
    if "dns: NXDOMAIN" in walk.errors:
        return _DnsFacts(errors=walk.errors)
    ns, ns_error = await _load_names(host, lookup, "NS")
    mx, mx_error = await _load_names(host, lookup, "MX")
    txt, txt_error = await _load_names(host, lookup, "TXT")
    flat = tuple(
        item
        for group in (walk.errors, (ns_error, mx_error, txt_error))
        for item in group
        if item is not None
    )
    connect = walk.ips[0] if walk.ips and walk.block_reason is None else None
    if walk.block_reason is not None:
        connect = None
    return _DnsFacts(walk.a, walk.aaaa, ns, mx, txt, connect, _dedupe(flat))


def _dn_pairs(value: object) -> tuple[tuple[str, str], ...]:
    if not isinstance(value, tuple):
        return ()
    pairs: list[tuple[str, str]] = []
    for rdn in value:
        if not isinstance(rdn, tuple):
            continue
        for item in rdn:
            if (
                isinstance(item, tuple)
                and len(item) == 2
                and isinstance(item[0], str)
                and isinstance(item[1], str)
            ):
                pairs.append((item[0], item[1]))
    return tuple(pairs)


def _cert_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or value == "":
        return None
    try:
        parsed = datetime.strptime(value, _CERT_TIME)
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC)


def _sans(value: object) -> tuple[str, ...] | None:
    if not isinstance(value, tuple):
        return None
    names: list[str] = []
    for item in value:
        if (
            isinstance(item, tuple)
            and len(item) == 2
            and isinstance(item[1], str)
            and item[1] != ""
        ):
            names.append(item[1])
    return _present(names)


def _tls_from_peer(
    decoded: Mapping[str, object],
    der: bytes,
) -> tuple[dict[str, object], tuple[str, ...]]:
    errors: list[str] = []
    if der == b"":
        errors.append("tls: empty certificate")
        return {}, tuple(errors)
    issuer_pairs = _dn_pairs(decoded.get("issuer"))
    subject_pairs = _dn_pairs(decoded.get("subject"))
    issuer = ", ".join(f"{key}={value}" for key, value in issuer_pairs) or None
    subject_cn = next((value for key, value in subject_pairs if key == "commonName"), None)
    not_before = _cert_datetime(decoded.get("notBefore"))
    not_after = _cert_datetime(decoded.get("notAfter"))
    if isinstance(decoded.get("notBefore"), str) and not_before is None:
        errors.append("tls: not_before is unreadable")
    if isinstance(decoded.get("notAfter"), str) and not_after is None:
        errors.append("tls: not_after is unreadable")
    facts: dict[str, object] = {
        "issuer": issuer,
        "subject_cn": subject_cn,
        "sans": _sans(decoded.get("subjectAltName")),
        "not_before": not_before,
        "not_after": not_after,
        "fingerprint_sha256": hashlib.sha256(der).hexdigest(),
    }
    return facts, tuple(errors)


async def _open_tls(host: str, ip: str) -> tuple[Mapping[str, object], bytes]:
    context = ssl.create_default_context()
    writer: asyncio.StreamWriter | None = None
    try:
        _reader, connected = await asyncio.wait_for(
            asyncio.open_connection(ip, _TLS_PORT, ssl=context, server_hostname=host),
            _TIMEOUT_SECONDS,
        )
        writer = connected
        peer = connected.get_extra_info("ssl_object")
        get_cert = getattr(peer, "getpeercert", None)
        if not callable(get_cert):
            raise OSError("TLS peer certificate is unavailable")
        der_raw = get_cert(True)
        decoded_raw = get_cert()
        if not isinstance(der_raw, bytes) or not isinstance(decoded_raw, dict):
            raise OSError("TLS peer certificate is unavailable")
        return cast(Mapping[str, object], decoded_raw), der_raw
    finally:
        if writer is not None:
            writer.close()
            await writer.wait_closed()


async def _load_tls(
    host: str,
    ip: str | None,
    open_tls: _TlsOpen,
) -> tuple[dict[str, object], tuple[str, ...]]:
    if ip is None:
        return {}, ()
    try:
        decoded, der = await open_tls(host, ip)
    except Exception as exc:
        return {}, (f"tls: {exc.__class__.__name__}",)
    return _tls_from_peer(decoded, der)


class _ResponseBody(httpx.AsyncByteStream):
    def __init__(self, stream: AsyncIterable[bytes]) -> None:
        self._stream = stream
        self._closed = False

    async def __aiter__(self) -> AsyncIterator[bytes]:
        try:
            async for chunk in self._stream:
                yield chunk
        finally:
            await self.aclose()

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        closer = getattr(self._stream, "aclose", None)
        if not callable(closer):
            return
        result = closer()
        if inspect.isawaitable(result):
            await result


class _PinnedBackend(httpcore.AsyncNetworkBackend):
    """Dial the public IP chosen for ``host`` and leave the name for SNI."""

    def __init__(
        self,
        lookup: _RecordLookup,
        inner: httpcore.AsyncNetworkBackend | None = None,
    ) -> None:
        self._lookup = lookup
        self._inner = inner if inner is not None else httpcore.AnyIOBackend()

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,  # noqa: ASYNC109
        local_address: str | None = None,
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        ascii_host, literal = _screen_host(host)
        ip = await _choose_ip(ascii_host, literal, self._lookup)
        return await self._inner.connect_tcp(
            ip,
            port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )

    async def connect_unix_socket(
        self,
        path: str,
        timeout: float | None = None,  # noqa: ASYNC109
        socket_options: Iterable[httpcore.SOCKET_OPTION] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        del path, timeout, socket_options
        _reject("host", "Unix sockets are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


class _SafeTransport(httpx.AsyncBaseTransport):
    def __init__(self, lookup: _RecordLookup) -> None:
        self._pool = httpcore.AsyncConnectionPool(
            ssl_context=httpx.create_ssl_context(trust_env=False),
            retries=0,
            network_backend=_PinnedBackend(lookup),
        )

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        content = request.stream
        if not isinstance(content, httpx.AsyncByteStream):
            raise httpx.TransportError("async transport received a sync body")
        outgoing = httpcore.Request(
            method=request.method,
            url=httpcore.URL(
                scheme=request.url.raw_scheme,
                host=request.url.raw_host,
                port=request.url.port,
                target=request.url.raw_path,
            ),
            headers=request.headers.raw,
            content=content,
            extensions=request.extensions,
        )
        incoming = await self._pool.handle_async_request(outgoing)
        body = incoming.stream
        if not isinstance(body, AsyncIterable):
            raise httpx.TransportError("response body is not async")
        return httpx.Response(
            status_code=incoming.status,
            headers=incoming.headers,
            stream=_ResponseBody(body),
            extensions=incoming.extensions,
        )

    async def aclose(self) -> None:
        await self._pool.aclose()


def _safe_client(lookup: _RecordLookup) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=_SafeTransport(lookup),
        trust_env=False,
        timeout=httpx.Timeout(_TIMEOUT_SECONDS),
        follow_redirects=False,
        max_redirects=0,
    )


def _http_facts(
    response: httpx.Response | None,
    hosts: tuple[str, ...],
    error: str | None,
) -> _HttpFacts:
    errors = () if error is None else (f"http: {error}",)
    if response is None:
        return _HttpFacts(errors=errors)
    server = response.headers.get("server")
    present = tuple(name for name in _SECURITY_HEADERS if name in response.headers)
    return _HttpFacts(
        status=response.status_code,
        server=server,
        security_headers=present,
        redirect_hosts=hosts or None,
        errors=errors,
    )


async def _exchange(
    client: httpx.AsyncClient,
    lookup: _RecordLookup,
    method: str,
    url: str,
) -> tuple[httpx.Response | None, tuple[str, ...], str | None]:
    current = url
    hosts: list[str] = []
    response: httpx.Response | None = None
    try:
        for hop in range(_MAX_REDIRECTS + 1):
            screened, host, literal = _screen_target(current)
            await _choose_ip(host, literal, lookup)
            response = await client.request(method, screened, follow_redirects=False)
            hosts.append(host)
            if response.status_code not in _REDIRECT_STATUSES or hop == _MAX_REDIRECTS:
                break
            location = response.headers.get("location")
            if location is None or location.strip() == "":
                break
            current = urljoin(screened, location.strip())
    except InvalidTargetError as exc:
        return response, tuple(hosts), exc.message
    except (httpx.HTTPError, httpcore.ProtocolError, httpcore.NetworkError) as exc:
        return response, tuple(hosts), exc.__class__.__name__
    return response, tuple(hosts), None


async def _load_http(
    client: httpx.AsyncClient,
    lookup: _RecordLookup,
    url: str,
    connect_ip: str | None,
) -> _HttpFacts:
    if connect_ip is None:
        return _HttpFacts()
    response, hosts, error = await _exchange(client, lookup, "HEAD", url)
    return _http_facts(response, hosts, error)


def _iso(value: str) -> datetime | None:
    text = value.strip()
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


def _as_map(value: object) -> Mapping[str, object] | None:
    if isinstance(value, dict):
        return cast(Mapping[str, object], value)
    return None


def _vcard_fn(entity: Mapping[str, object]) -> str | None:
    vcard = entity.get("vcardArray")
    if not isinstance(vcard, list) or len(vcard) < 2 or not isinstance(vcard[1], list):
        return None
    for row in vcard[1]:
        if not isinstance(row, list) or len(row) < 4:
            continue
        name = row[0]
        value = row[3]
        if (
            isinstance(name, str)
            and name.lower() == "fn"
            and isinstance(value, str)
            and value.strip()
        ):
            return value.strip()
    return None


def _entities(node: object, depth: int = 0) -> Iterable[Mapping[str, object]]:
    if depth > 8:
        return
    mapping = _as_map(node)
    if mapping is None:
        return
    yield mapping
    children = mapping.get("entities")
    if not isinstance(children, list):
        return
    for child in children:
        yield from _entities(child, depth + 1)


def _registrar_name(document: Mapping[str, object]) -> str | None:
    for entity in _entities(document):
        roles = entity.get("roles")
        if not isinstance(roles, list):
            continue
        if not any(isinstance(role, str) and role.lower() == "registrar" for role in roles):
            continue
        name = _vcard_fn(entity)
        if name is not None:
            return name
    return None


def _created_at(document: Mapping[str, object]) -> tuple[datetime | None, bool]:
    events = document.get("events")
    if not isinstance(events, list):
        return None, False
    for event in events:
        mapping = _as_map(event)
        if mapping is None:
            continue
        action = mapping.get("eventAction")
        if not isinstance(action, str) or action.lower() not in {"registration", "registered"}:
            continue
        raw = mapping.get("eventDate")
        if not isinstance(raw, str) or raw.strip() == "":
            return None, False
        parsed = _iso(raw)
        return parsed, parsed is None
    return None, False


def _rdap_nameservers(document: Mapping[str, object]) -> tuple[str, ...] | None:
    raw = document.get("nameservers")
    if not isinstance(raw, list):
        return None
    names: list[str] = []
    for item in raw:
        if isinstance(item, str) and item.strip():
            names.append(item.strip().lower().rstrip("."))
            continue
        mapping = _as_map(item)
        if mapping is None:
            continue
        name = mapping.get("ldhName")
        if not isinstance(name, str):
            name = mapping.get("unicodeName")
        if isinstance(name, str) and name.strip():
            names.append(name.strip().lower().rstrip("."))
    return _present(names)


def _rdap_base(payload: object, host: str) -> str | None:
    document = _as_map(payload)
    if document is None:
        return None
    services = document.get("services")
    if not isinstance(services, list):
        return None
    best: tuple[int, str] | None = None
    for service in services:
        if not isinstance(service, list) or len(service) < 2:
            continue
        tlds = service[0]
        bases = service[1]
        if not isinstance(tlds, list) or not isinstance(bases, list):
            continue
        for base in bases:
            if not isinstance(base, str) or base.strip() == "":
                continue
            for tld in tlds:
                if not isinstance(tld, str):
                    continue
                suffix = tld.strip().lower().rstrip(".")
                if suffix == "" or not (host == suffix or host.endswith(f".{suffix}")):
                    continue
                if best is None or len(suffix) > best[0]:
                    best = (len(suffix), base.strip())
    if best is None:
        return None
    base = best[1]
    return base if base.endswith("/") else f"{base}/"


def _parse_rdap(payload: object) -> _Registration:
    document = _as_map(payload)
    if document is None:
        return _Registration(errors=("registration: malformed RDAP document",))
    created, bad_date = _created_at(document)
    errors = ("registration: created date is unreadable",) if bad_date else ()
    return _Registration(
        registrar=_registrar_name(document),
        created=created,
        nameservers=_rdap_nameservers(document),
        errors=errors,
    )


async def _load_registration(
    client: httpx.AsyncClient,
    lookup: _RecordLookup,
    host: str,
    literal: _IP | None,
) -> _Registration:
    if literal is not None:
        return _Registration()
    response, _hosts, error = await _exchange(client, lookup, "GET", _RDAP_BOOTSTRAP)
    if error is not None:
        return _Registration(errors=(f"registration: {error}",))
    if response is None or response.status_code != 200:
        code = response.status_code if response is not None else 0
        return _Registration(errors=(f"registration: HTTP {code}",))
    try:
        bootstrap = response.json()
    except ValueError:
        return _Registration(errors=("registration: malformed RDAP bootstrap",))
    base = _rdap_base(bootstrap, host)
    if base is None:
        return _Registration(errors=("registration: no RDAP service",))
    query = urljoin(base, f"domain/{host}")
    document, _doc_hosts, doc_error = await _exchange(client, lookup, "GET", query)
    if doc_error is not None:
        return _Registration(errors=(f"registration: {doc_error}",))
    if document is None or document.status_code == 404:
        return _Registration(errors=("registration: HTTP 404",))
    if document.status_code != 200:
        return _Registration(errors=(f"registration: HTTP {document.status_code}",))
    try:
        payload = document.json()
    except ValueError:
        return _Registration(errors=("registration: malformed RDAP document",))
    return _parse_rdap(payload)


def _add_indicator(
    found: list[Indicator],
    seen: set[tuple[str, str]],
    kind: _Kind,
    value: str | None,
) -> None:
    if value is None or value == "":
        return
    key = (kind, value)
    if key in seen:
        return
    seen.add(key)
    found.append(Indicator(kind=kind, value=value))


def _indicators(
    host: str,
    literal: _IP | None,
    dns: _DnsFacts,
    fingerprint: str | None,
    registration: _Registration,
) -> tuple[Indicator, ...]:
    found: list[Indicator] = []
    seen: set[tuple[str, str]] = set()
    if literal is None:
        _add_indicator(found, seen, "domain", host)
    for addresses in (dns.a, dns.aaaa):
        if addresses is None:
            continue
        for address in addresses:
            _add_indicator(found, seen, "ip", address)
    for names in (dns.ns, registration.nameservers):
        if names is None:
            continue
        for name in names:
            _add_indicator(found, seen, "ns", name)
    _add_indicator(found, seen, "cert_fingerprint", fingerprint)
    _add_indicator(found, seen, "registrar", registration.registrar)
    return tuple(found)


def _text(facts: dict[str, object], key: str) -> str | None:
    value = facts.get(key)
    return value if isinstance(value, str) else None


def _stamp(facts: dict[str, object], key: str) -> datetime | None:
    value = facts.get(key)
    return value if isinstance(value, datetime) else None


def _names(facts: dict[str, object], key: str) -> tuple[str, ...] | None:
    value = facts.get(key)
    if isinstance(value, tuple) and all(isinstance(item, str) for item in value):
        return cast(tuple[str, ...], value)
    return None


async def enrich(
    url: str,
    *,
    resolver: dns.asyncresolver.Resolver | None = None,
    lookup: _RecordLookup | None = None,
    client: httpx.AsyncClient | None = None,
    open_tls: _TlsOpen | None = None,
) -> InfraProfile:
    """Collect DNS, TLS, HTTP, and RDAP facts for ``url``.

    An invalid target raises ``InvalidTargetError``. A failed lookup is stored
    in ``errors`` and the other lookups still run. ``lookup``, ``client``, and
    ``open_tls`` override the network implementations; the default client pins
    each connection to a public address from ``lookup``.
    """
    normalized, host, literal = _screen_target(url)
    active: _RecordLookup = lookup if lookup is not None else _DnspythonLookup(resolver)
    shared = _CachingLookup(active)
    owns_client = client is None
    http = client if client is not None else _safe_client(shared)
    probe = open_tls if open_tls is not None else _open_tls
    try:
        dns_facts = await _load_dns(host, literal, shared)
        tls_facts, tls_errors = await _load_tls(host, dns_facts.connect_ip, probe)
        http_facts = await _load_http(http, shared, normalized, dns_facts.connect_ip)
        registration = await _load_registration(http, shared, host, literal)
    finally:
        if owns_client:
            await http.aclose()

    fingerprint = _text(tls_facts, "fingerprint_sha256")
    return InfraProfile(
        a=dns_facts.a,
        aaaa=dns_facts.aaaa,
        ns=dns_facts.ns,
        mx=dns_facts.mx,
        txt=dns_facts.txt,
        issuer=_text(tls_facts, "issuer"),
        subject_cn=_text(tls_facts, "subject_cn"),
        sans=_names(tls_facts, "sans"),
        not_before=_stamp(tls_facts, "not_before"),
        not_after=_stamp(tls_facts, "not_after"),
        fingerprint_sha256=fingerprint,
        status=http_facts.status,
        server=http_facts.server,
        security_headers=http_facts.security_headers,
        redirect_hosts=http_facts.redirect_hosts,
        registrar=registration.registrar,
        created=registration.created,
        nameservers=registration.nameservers,
        errors=_dedupe((*dns_facts.errors, *tls_errors, *http_facts.errors, *registration.errors)),
        indicators=_indicators(host, literal, dns_facts, fingerprint, registration),
    )
