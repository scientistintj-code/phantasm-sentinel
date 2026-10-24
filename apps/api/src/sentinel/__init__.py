"""Phantasm Sentinel web-forensics API."""

from importlib.metadata import PackageNotFoundError, version

# The distribution name in pyproject.toml is "api"; the import package is sentinel.
try:
    __version__ = version("api")
except PackageNotFoundError:  # pragma: no cover
    __version__ = "0.1.0"
