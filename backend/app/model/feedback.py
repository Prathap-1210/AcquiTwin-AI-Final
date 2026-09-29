from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class OfficerFeedback(Base):
    __tablename__ = "officer_feedback"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    prediction_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "predictions.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    user_id: Mapped[int | None] = mapped_column(
        ForeignKey(
            "users.id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )

    predicted_delay_days: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    actual_delay_days: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    prediction_error_days: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
    )

    notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
    )