"""Parsers for structured JSON returned by active navigation.

Shapes follow the indicator and evidence objects in the API contract.
Missing fields use defaults. Unrecognized values fall back to those defaults.
A payload that is not an object parses as an empty result.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

IndicatorKind = Literal[
    "publishable_key",
    "merchant_id",
    "client_id",
    "processor_host",
    "form_action_host",
    "checkout_script_host",
    "descriptor",
    "telegram",
    "email",
    "phone",
    "ip",
    "ns",
    "cert_fingerprint",
    "registrar",
    "domain",
]
IndicatorSource = Literal["agent", "infra"]
EvidenceField = Literal[
    "merchant_id",
    "gateway",
    "payment_endpoint",
    "host_ip",
    "domain_age",
    "ssl_issuer",
    "suspicious_scripts",
    "redirect_chain",
]
EvidenceSeverity = Literal["safe", "medium", "high"]
EvidenceSource = Literal["agent", "infra", "derived"]

_INDICATOR_KINDS = frozenset(
    {
        "publishable_key",
        "merchant_id",
        "client_id",
        "processor_host",
        "form_action_host",
        "checkout_script_host",
        "descriptor",
        "telegram",
        "email",
        "phone",
        "ip",
        "ns",
        "cert_fingerprint",
        "registrar",
        "domain",
    }
)
_EVIDENCE_LABELS: dict[EvidenceField, str] = {
    "merchant_id": "Merchant ID",
    "gateway": "Gateway",
    "payment_endpoint": "Payment Endpoint",
    "host_ip": "Host IP",
    "domain_age": "Domain Age",
    "ssl_issuer": "SSL Issuer",
    "suspicious_scripts": "Suspicious Scripts",
    "redirect_chain": "Redirect Chain",
}
_EVIDENCE_FIELDS = frozenset(_EVIDENCE_LABELS)
_INDICATOR_SOURCES = frozenset({"agent", "infra"})
_EVIDENCE_SEVERITIES = frozenset({"safe", "medium", "high"})
_EVIDENCE_SOURCES = frozenset({"agent", "infra", "derived"})
_TRUE_WORDS = frozenset({"1", "true", "yes", "y"})

_ModelT = TypeVar("_ModelT", bound=BaseModel)
_ChoiceT = TypeVar("_ChoiceT", bound=str)


def _mapping(value: object) -> dict[str, object] | None:
    if not isinstance(value, Mapping):
        return None
    return {key: item for key, item in value.items() if isinstance(key, str)}


def _strings(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        rows: Sequence[object] = (value,)
    elif isinstance(value, list | tuple):
        rows = value
    else:
        return ()
    items: list[str] = []
    for item in rows:
        if isinstance(item, str):
            text = item.strip()
            if text != "":
                items.append(text)
    return tuple(items)


def _clamp_confidence(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float | str):
        return 0.0
    try:
        number = float(value)
    except ValueError:
        return 0.0
    if number < 0.0:
        return 0.0
    if number > 1.0:
        return 1.0
    return number


def _flag(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int | float):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in _TRUE_WORDS
    return False


def _choice(value: object, allowed: frozenset[_ChoiceT], default: _ChoiceT) -> _ChoiceT:
    if isinstance(value, str) and value in allowed:
        return value
    return default


def _text(value: object) -> str:
    if isinstance(value, str):
        return value.strip()
    return ""


class MerchantIdentities(BaseModel):
    """Public identity claims captured from the storefront."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    brand_claims: tuple[str, ...] = ()
    merchant_identifiers: tuple[str, ...] = ()
    support_emails: tuple[str, ...] = ()
    support_phones: tuple[str, ...] = ()
    refund_policy_urls: tuple[str, ...] = ()
    registration_details: tuple[str, ...] = ()

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, value: object) -> object:
        data = _mapping(value)
        if data is None:
            return {}
        for key in (
            "brand_claims",
            "merchant_identifiers",
            "support_emails",
            "support_phones",
            "refund_policy_urls",
            "registration_details",
        ):
            if key in data:
                data[key] = _strings(data[key])
        return data


class EvidenceItem(BaseModel):
    """One evidence row. Field names and labels match TargetReport."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    field: EvidenceField = "merchant_id"
    label: str = "Merchant ID"
    value: str = ""
    severity: EvidenceSeverity = "safe"
    source: EvidenceSource = "agent"

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, value: object) -> object:
        data = _mapping(value)
        if data is None:
            return {}
        field = _choice(data.get("field"), _EVIDENCE_FIELDS, "merchant_id")
        raw_label = data.get("label")
        if isinstance(raw_label, str) and raw_label.strip() != "" and field == data.get("field"):
            label = raw_label.strip()
        else:
            label = _EVIDENCE_LABELS[field]
        severity = _choice(data.get("severity"), _EVIDENCE_SEVERITIES, "safe")
        source = _choice(data.get("source"), _EVIDENCE_SOURCES, "agent")
        return {
            "field": field,
            "label": label,
            "value": _text(data.get("value")),
            "severity": severity,
            "source": source,
        }


class ProcessingDetails(BaseModel):
    """Payment processors observed before the safety stop."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    payment_processors: tuple[str, ...] = ()
    reached_checkout: bool = False
    stopped_reason: str = ""

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, value: object) -> object:
        data = _mapping(value)
        if data is None:
            return {}
        normalized: dict[str, object] = {}
        if "payment_processors" in data:
            normalized["payment_processors"] = _strings(data["payment_processors"])
        if "reached_checkout" in data:
            normalized["reached_checkout"] = _flag(data["reached_checkout"])
        if "stopped_reason" in data:
            normalized["stopped_reason"] = _text(data["stopped_reason"])
        return normalized


class IndicatorCandidate(BaseModel):
    """One indicator. ``kind`` and ``source`` match the API contract."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    kind: IndicatorKind = "domain"
    value: str = ""
    confidence: float = 0.0
    source: IndicatorSource = "agent"

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, value: object) -> object:
        data = _mapping(value)
        if data is None:
            return {}
        kind = _choice(data.get("kind"), _INDICATOR_KINDS, "domain")
        source = _choice(data.get("source"), _INDICATOR_SOURCES, "agent")
        confidence = _clamp_confidence(data["confidence"]) if "confidence" in data else 0.0
        return {
            "kind": kind,
            "value": _text(data.get("value")),
            "confidence": confidence,
            "source": source,
        }


class ActiveNavigationResult(BaseModel):
    """Structured object returned by the active navigation goal."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    merchant_identities: MerchantIdentities = Field(default_factory=MerchantIdentities)
    evidence: tuple[EvidenceItem, ...] = ()
    processing: ProcessingDetails = Field(default_factory=ProcessingDetails)
    indicators: tuple[IndicatorCandidate, ...] = ()

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, value: object) -> object:
        data = _mapping(value)
        if data is None:
            return {}
        if "merchant_identities" in data:
            identities: object = data["merchant_identities"]
        else:
            identities = data
        if "processing" in data:
            processing: object = data["processing"]
        else:
            processing = data
        return {
            "merchant_identities": identities if isinstance(identities, Mapping) else {},
            "processing": processing if isinstance(processing, Mapping) else {},
            "evidence": _models(data.get("evidence"), EvidenceItem),
            "indicators": _models(data.get("indicators"), IndicatorCandidate),
        }


def _models(value: object, model: type[_ModelT]) -> tuple[_ModelT, ...]:
    if isinstance(value, Mapping):
        rows: Sequence[object] = (value,)
    elif isinstance(value, list | tuple):
        rows = value
    else:
        return ()
    parsed: list[_ModelT] = []
    for row in rows:
        if isinstance(row, model):
            parsed.append(row)
            continue
        item = _mapping(row)
        if item is None:
            continue
        try:
            parsed.append(model.model_validate(item))
        except ValidationError:
            continue
    return tuple(parsed)


def _load(payload: object) -> object:
    if not isinstance(payload, str):
        return payload
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return None


def parse_merchant_identities(payload: object) -> MerchantIdentities:
    """Parse merchant identity claims. Bad input returns an empty model."""
    try:
        return MerchantIdentities.model_validate(_load(payload))
    except ValidationError:
        return MerchantIdentities()


def parse_evidence_item(payload: object) -> EvidenceItem:
    """Parse one evidence row. Bad input returns the default row."""
    try:
        return EvidenceItem.model_validate(_load(payload))
    except ValidationError:
        return EvidenceItem()


def parse_processing_details(payload: object) -> ProcessingDetails:
    """Parse processor observations. Bad input returns an empty model."""
    try:
        return ProcessingDetails.model_validate(_load(payload))
    except ValidationError:
        return ProcessingDetails()


def parse_indicator_candidate(payload: object) -> IndicatorCandidate:
    """Parse one indicator. Bad input returns the default candidate."""
    try:
        return IndicatorCandidate.model_validate(_load(payload))
    except ValidationError:
        return IndicatorCandidate()


def parse_active_navigation(payload: object) -> ActiveNavigationResult:
    """Parse the active-stage JSON object. Bad input returns an empty result."""
    loaded = _load(payload)
    if isinstance(loaded, ActiveNavigationResult):
        return loaded
    try:
        return ActiveNavigationResult.model_validate(loaded)
    except ValidationError:
        return ActiveNavigationResult()
