"""Validation of URLs that sentinel may fetch."""

import ipaddress
import re
import socket
from typing import NoReturn
from urllib.parse import unquote, urlsplit

from sentinel.core.errors import InvalidTargetError

_HOSTNAME_RE = re.compile(
    r"(?=.{1,253}$)"
    r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    r"(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*"
)
_IPV4_COMPONENT_RE = re.compile(r"(?i)^(?:0x[0-9a-f]+|\d+)$")
_LOOPBACK_NAMES = frozenset({"localhost", "localhost.localdomain"})
_METADATA_NAMES = frozenset({"metadata.google.internal", "metadata.goog"})
# Instance metadata endpoints. 168.63.129.16 is a public Azure address, so the
# private/link-local checks do not cover it.
_METADATA_ADDRESSES = frozenset(
    {
        ipaddress.ip_address("169.254.169.254"),
        ipaddress.ip_address("169.254.170.2"),
        ipaddress.ip_address("168.63.129.16"),
        ipaddress.ip_address("100.100.100.200"),
        ipaddress.ip_address("fd00:ec2::254"),
    }
)
_MESSAGES = {
    "scheme": "Only http and https URLs are allowed",
    "userinfo": "URLs must not include embedded credentials",
    "host": "URL must include a valid host",
    "loopback": "Loopback addresses are not allowed",
    "link-local": "Link-local addresses are not allowed",
    "private": "Private addresses are not allowed",
    "reserved": "Reserved addresses are not allowed",
    "cloud-metadata": "Cloud metadata addresses are not allowed",
    "unresolved": "Target host could not be resolved",
}

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


def _reject(
    reason: str,
    message: str | None = None,
    *,
    cause: BaseException | None = None,
) -> NoReturn:
    raise InvalidTargetError(message or _MESSAGES[reason], reason=reason) from cause


def _component_value(part: str) -> int:
    if part.lower().startswith("0x"):
        return int(part, 16)
    if len(part) > 1 and part.startswith("0"):
        return int(part, 8)
    return int(part, 10)


def _pack_ipv4(numbers: tuple[int, ...]) -> int:
    widths = {1: (32,), 2: (8, 24), 3: (8, 8, 16), 4: (8, 8, 8, 8)}[len(numbers)]
    value = 0
    for number, width in zip(numbers, widths, strict=True):
        if number < 0 or number >= 1 << width:
            raise ValueError
        value = (value << width) | number
    return value


def _ipv4_literal(host: str) -> ipaddress.IPv4Address | None:
    """Parse an IPv4 literal, including inet_aton forms that hide loopback addresses."""
    parts = host.split(".")
    if not 1 <= len(parts) <= 4:
        return None
    if any(_IPV4_COMPONENT_RE.fullmatch(part) is None for part in parts):
        return None
    try:
        numbers = tuple(_component_value(part) for part in parts)
        return ipaddress.IPv4Address(_pack_ipv4(numbers))
    except ValueError as exc:
        _reject("host", cause=exc)


def _unwrap(ip: IPAddress) -> IPAddress:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    return ip


def _literal_address(host: str) -> IPAddress | None:
    candidate = host.split("%", 1)[0]
    try:
        parsed: IPAddress | None = ipaddress.ip_address(candidate)
    except ValueError:
        parsed = None
    if parsed is not None:
        return _unwrap(parsed)
    if ":" in host:
        _reject("host")
    return _ipv4_literal(host)


def _classify(ip: IPAddress) -> str | None:
    address = _unwrap(ip)
    if address in _METADATA_ADDRESSES:
        return "cloud-metadata"
    if address.is_loopback:
        return "loopback"
    if address.is_link_local:
        return "link-local"
    if address.is_multicast or address.is_reserved or address.is_unspecified:
        return "reserved"
    if address.is_private or not address.is_global:
        return "private"
    return None


def _reject_address(ip: IPAddress) -> None:
    reason = _classify(ip)
    if reason is not None:
        _reject(reason)


def _idna(host: str) -> str:
    try:
        return host.encode("idna").decode("ascii").lower()
    except UnicodeError as exc:
        _reject("host", cause=exc)


def _resolve(host: str) -> tuple[IPAddress, ...]:
    try:
        records = socket.getaddrinfo(
            host,
            None,
            family=socket.AF_UNSPEC,
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror as exc:
        _reject("unresolved", cause=exc)

    addresses: list[IPAddress] = []
    seen: set[str] = set()
    for record in records:
        raw = str(record[4][0]).split("%", 1)[0]
        try:
            parsed = _unwrap(ipaddress.ip_address(raw))
        except ValueError as exc:
            _reject("unresolved", cause=exc)
        key = parsed.compressed
        if key in seen:
            continue
        seen.add(key)
        addresses.append(parsed)
    if not addresses:
        _reject("unresolved")
    return tuple(addresses)


def _format_url(scheme: str, host: str, port: int | None, path: str, query: str) -> str:
    if (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        port = None
    host_part = f"[{host}]" if ":" in host else host
    netloc = f"{host_part}:{port}" if port is not None else host_part
    suffix = path or "/"
    if query:
        suffix = f"{suffix}?{query}"
    return f"{scheme}://{netloc}{suffix}"


def validate_target_url(url: str) -> str:
    """Validate a target URL and return its normalized form.

    Allows http and https only. Rejects embedded credentials, then resolves the
    host and rejects loopback, private, link-local, reserved, and cloud-metadata
    addresses. The DNS lookup is blocking.
    """
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

    literal = _literal_address(host)
    if literal is not None:
        _reject_address(literal)
        return _format_url(scheme, str(literal), port, parsed.path, parsed.query)

    ascii_host = _idna(host)
    if ascii_host in _LOOPBACK_NAMES:
        _reject("loopback")
    if ascii_host in _METADATA_NAMES:
        _reject("cloud-metadata")
    if _HOSTNAME_RE.fullmatch(ascii_host) is None:
        _reject("host")

    for address in _resolve(ascii_host):
        _reject_address(address)
    return _format_url(scheme, ascii_host, port, parsed.path, parsed.query)
