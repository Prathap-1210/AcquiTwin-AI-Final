from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class Intervention(Base):
    __tablename__ = "interventions"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    intervention_type: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )

    target_feature: Mapped[str | None] = mapped_column(
        String(150),
        nullable=True,
    )

    current_value: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    proposed_value: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    original_risk: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    simulated_risk: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    estimated_risk_reduction: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    priority_score: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(50),
        default="PROPOSED",
    )

    details: Mapped[dict[str, Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
    )