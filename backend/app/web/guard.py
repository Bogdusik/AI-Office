"""Which addresses an agent may open: public http(s) only, never this computer or the local network.

The check runs on the resolved IP addresses (all of them), so a public-looking name that points at
127.0.0.1 or 192.168.x.x is refused too; the fetcher then connects to the checked IP itself.
"""

import asyncio
import ipaddress
import socket
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from urllib.parse import urlsplit

ALLOWED_SCHEMES = frozenset({"http", "https"})
ALLOWED_PORTS = frozenset({80, 443, 8080, 8443})

Resolver = Callable[[str, int], Awaitable[list[str]]]


class BlockedUrl(Exception):
    """The address is not allowed; the message is shown to the model and the director."""


@dataclass(frozen=True)
class Target:
    url: str
    scheme: str
    host: str
    port: int
    path: str
    """Path with the query string, as sent in the request line."""


def parse_target(url: str) -> Target:
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise BlockedUrl(f"only http and https are allowed, not '{scheme or 'none'}'")
    if parts.username is not None or parts.password is not None:
        raise BlockedUrl("addresses with a login are not allowed")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host:
        raise BlockedUrl("the address has no host")
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan", ".home.arpa")):
        raise BlockedUrl(f"'{host}' is a local address")
    try:
        port = parts.port or (443 if scheme == "https" else 80)
    except ValueError as err:
        raise BlockedUrl("the port is not valid") from err
    if port not in ALLOWED_PORTS:
        raise BlockedUrl(f"port {port} is not allowed")
    path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
    return Target(url=url.strip(), scheme=scheme, host=host, port=port, path=path)


def is_public_ip(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address):
        mapped = ip.ipv4_mapped or ip.sixtofour or (ip.teredo[1] if ip.teredo else None)
        if mapped is not None:
            ip = mapped
    return ip.is_global and not ip.is_multicast and not ip.is_reserved


async def system_resolver(host: str, port: int) -> list[str]:
    infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return list(dict.fromkeys(str(info[4][0]) for info in infos))


async def resolve_public(target: Target, resolver: Resolver = system_resolver) -> str:
    """Returns the IP to connect to; refuses when any resolved address is local or private."""
    try:
        ipaddress.ip_address(target.host.strip("[]"))
        addresses = [target.host.strip("[]")]
    except ValueError:
        try:
            addresses = await resolver(target.host, target.port)
        except OSError as err:
            raise BlockedUrl(f"cannot resolve '{target.host}'") from err
    if not addresses:
        raise BlockedUrl(f"cannot resolve '{target.host}'")
    for address in addresses:
        if not is_public_ip(address):
            raise BlockedUrl(f"'{target.host}' points to a local or private address")
    return addresses[0]
