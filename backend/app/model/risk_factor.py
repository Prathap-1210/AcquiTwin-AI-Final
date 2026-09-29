from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class RiskFactor(Base):
    __tablename__ = "risk_factors"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    prediction_id: Mapped[int] = mapped_column(
        ForeignKey(
            "predictions.id",
            ondelete="CASCADE",
        ),
        nullable=False,
        index=True,
    )

    feature_name: Mapped[str] = mapped_column(
        String(150),
        nullable=False,
    )

    feature_value: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    contribution: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    importance_rank: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    direction: Mapped[str | None] = mapped_column(
        String(30),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=datetime.utcnow,
    )