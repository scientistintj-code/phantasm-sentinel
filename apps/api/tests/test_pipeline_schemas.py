"""Active-navigation schemas accept complete and partial JSON."""

from __future__ import annotations

from sentinel.pipeline.schemas import (
    ActiveNavigationResult,
    EvidenceItem,
    IndicatorCandidate,
    MerchantIdentities,
    ProcessingDetails,
    parse_active_navigation,
    parse_evidence_item,
    parse_indicator_candidate,
    parse_merchant_identities,
    parse_processing_details,
)

_COMPLETE = {
    "merchant_identities": {
        "brand_claims": ["Northwind Outfitters"],
        "merchant_identifiers": ["acct_123"],
        "support_emails": ["help@northwind.example"],
        "support_phones": ["+1-555-0100"],
        "refund_policy_urls": ["https://northwind.example/refunds"],
        "registration_details": ["Northwind LLC, Delaware"],
    },
    "processing": {
        "payment_processors": ["stripe"],
        "reached_checkout": True,
        "stopped_reason": "authorization screen",
    },
    "evidence": [
        {
            "field": "gateway",
            "label": "Gateway",
            "value": "stripe",
            "severity": "high",
            "source": "agent",
        }
    ],
    "indicators": [
        {
            "kind": "merchant_id",
            "value": "acct_123",
            "confidence": 0.5,
            "source": "agent",
        }
    ],
}


def test_complete_payload() -> None:
    result = parse_active_navigation(_COMPLETE)
    assert result.merchant_identities.brand_claims == ("Northwind Outfitters",)
    assert result.merchant_identities.merchant_identifiers == ("acct_123",)
    assert result.merchant_identities.support_emails == ("help@northwind.example",)
    assert result.merchant_identities.support_phones == ("+1-555-0100",)
    assert result.merchant_identities.refund_policy_urls == ("https://northwind.example/refunds",)
    assert result.merchant_identities.registration_details == ("Northwind LLC, Delaware",)
    assert result.processing == ProcessingDetails(
        payment_processors=("stripe",),
        reached_checkout=True,
        stopped_reason="authorization screen",
    )
    assert result.evidence == (
        EvidenceItem(
            field="gateway",
            label="Gateway",
            value="stripe",
            severity="high",
            source="agent",
        ),
    )
    assert result.indicators == (
        IndicatorCandidate(kind="merchant_id", value="acct_123", confidence=0.5, source="agent"),
    )


def test_partial_payload_uses_defaults() -> None:
    result = parse_active_navigation(
        {
            "brand_claims": ["Northwind"],
            "indicators": [{"kind": "email", "value": "help@northwind.example"}],
            "evidence": [{"field": "gateway", "value": "stripe.com"}],
        }
    )
    assert result.merchant_identities.brand_claims == ("Northwind",)
    assert result.merchant_identities.support_emails == ()
    assert result.processing == ProcessingDetails()
    assert result.evidence == (EvidenceItem(field="gateway", label="Gateway", value="stripe.com"),)
    assert result.indicators == (IndicatorCandidate(kind="email", value="help@northwind.example"),)
    assert parse_merchant_identities({}) == MerchantIdentities()
    assert parse_processing_details({}) == ProcessingDetails()
    assert parse_evidence_item({}) == EvidenceItem()
    assert parse_indicator_candidate({}) == IndicatorCandidate()


def test_malformed_payload_uses_defaults() -> None:
    assert parse_active_navigation(None) == ActiveNavigationResult()
    assert parse_active_navigation("{") == ActiveNavigationResult()
    assert parse_active_navigation(["nope"]) == ActiveNavigationResult()

    messy = parse_active_navigation(
        {
            "merchant_identities": "nope",
            "processing": [],
            "evidence": [
                "skip",
                {"field": "nope", "severity": "urgent", "source": "web", "value": "x"},
            ],
            "indicators": [
                4,
                {"kind": "nope", "confidence": "high", "source": "web", "value": " pk_test "},
            ],
            "unexpected": {"ignore": True},
        }
    )
    assert messy.merchant_identities == MerchantIdentities()
    assert messy.processing == ProcessingDetails()
    assert messy.evidence == (EvidenceItem(value="x"),)
    assert messy.indicators == (IndicatorCandidate(value="pk_test"),)

    clamped = parse_indicator_candidate({"kind": "phone", "value": "+1555", "confidence": 4})
    assert clamped.confidence == 1.0
    low = parse_indicator_candidate({"kind": "phone", "confidence": -2, "value": "+1555"})
    assert low.confidence == 0.0

    loaded = parse_active_navigation(
        '{"payment_processors":["adyen"],"reached_checkout":"yes","stopped_reason":"checkout"}'
    )
    assert loaded.processing.payment_processors == ("adyen",)
    assert loaded.processing.reached_checkout is True
    assert loaded.processing.stopped_reason == "checkout"
