from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class ProjectStageHistory(Base):
    __tablename__ = "project_stage_history"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    stage_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )

    stage_status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )

    progress_percentage: Mapped[float] = mapped_column(
        Float,
        default=0,
    )

    risk_score: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    expected_duration_days: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    actual_duration_days: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    # Actual date on which the stage began.
    # Leave NULL when the date is unknown.
    actual_start_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
    )

    # Planned deadline, not an actual completion date.
    planned_end_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
    )

    # Actual completion date, recorded only when confirmed.
    actual_completion_date: Mapped[date | None] = mapped_column(
        Date,
        nullable=True,
    )

    notes: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    # When this database record was created.
    # This is NOT the actual stage start date.
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
    )