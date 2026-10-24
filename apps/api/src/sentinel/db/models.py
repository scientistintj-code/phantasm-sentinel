"""SQLite and Postgres tables for a case and its investigation records."""

from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from sentinel.db.base import Base


class CaseRow(Base):
    """One investigation case. ``number`` matches ``PS-YYYY-NNNN``."""

    __tablename__ = "cases"
    __table_args__ = (UniqueConstraint("year", "sequence", name="uq_case_year_sequence"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    number: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    title: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), index=True)
    authorized_by: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String(32))
    year: Mapped[int] = mapped_column(Integer)
    sequence: Mapped[int] = mapped_column(Integer)
    targets: Mapped[list[TargetRow]] = relationship(
        back_populates="case",
        order_by="TargetRow.position",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class TargetRow(Base):
    """An accepted target URL. Rejected URLs are not stored."""

    __tablename__ = "targets"
    __table_args__ = (UniqueConstraint("case_id", "target_id", name="uq_target_case"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"),
        index=True,
    )
    target_id: Mapped[str] = mapped_column(String(64))
    url: Mapped[str] = mapped_column(Text)
    host: Mapped[str] = mapped_column(String(253))
    accepted: Mapped[bool] = mapped_column(Boolean, default=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    position: Mapped[int] = mapped_column(Integer)
    report: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    case: Mapped[CaseRow] = relationship(back_populates="targets")


class IndicatorRow(Base):
    """One indicator extracted for a target."""

    __tablename__ = "indicators"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"),
        index=True,
    )
    target_id: Mapped[str] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(64))
    value: Mapped[str] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(16))


class EvidenceRow(Base):
    """One evidence cell from a target report, in contract order."""

    __tablename__ = "evidence"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[str] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"),
        index=True,
    )
    target_id: Mapped[str] = mapped_column(String(64), index=True)
    position: Mapped[int] = mapped_column(Integer)
    field: Mapped[str] = mapped_column(String(64))
    label: Mapped[str] = mapped_column(Text)
    value: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(16))
    source: Mapped[str] = mapped_column(String(16))


class GraphRow(Base):
    """Latest graph snapshot for a case."""

    __tablename__ = "graphs"

    case_id: Mapped[str] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"),
        primary_key=True,
    )
    version: Mapped[int] = mapped_column(Integer)
    nodes: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    edges: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    clusters: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    insight: Mapped[str] = mapped_column(Text)


class LedgerEntryRow(Base):
    """One append-only ledger row. ``payload`` is the event object."""

    __tablename__ = "ledger_entries"

    case_id: Mapped[str] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"),
        primary_key=True,
    )
    seq: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[str] = mapped_column(String(32))
    event_type: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    prev_hash: Mapped[str] = mapped_column(String(64))
    entry_hash: Mapped[str] = mapped_column(String(64))


class LedgerHeadRow(Base):
    """Signed head stored beside the entries for one case."""

    __tablename__ = "ledger_heads"

    case_id: Mapped[str] = mapped_column(
        ForeignKey("cases.id", ondelete="CASCADE"),
        primary_key=True,
    )
    signature: Mapped[str] = mapped_column(String(64))
    head_hash: Mapped[str] = mapped_column(String(64))
    entry_count: Mapped[int] = mapped_column(Integer)
