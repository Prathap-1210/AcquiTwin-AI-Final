from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Integer,
    String,
    Text,
)

from sqlalchemy.dialects.postgresql import JSONB

# IMPORTANT:
# If your current project.py imports Base from a different file,
# keep your existing Base import instead of changing it.
from app.database.base import Base


class Project(Base):
    __tablename__ = "projects"

    # ============================================================
    # PRIMARY KEY
    # ============================================================

    id = Column(
        Integer,
        primary_key=True,
        index=True,
    )

    # ============================================================
    # PROJECT IDENTITY
    # ============================================================

    project_id = Column(
        String(100),
        nullable=False,
        unique=True,
        index=True,
    )

    project_name = Column(
        String(300),
        nullable=False,
    )

    project_type = Column(
        String(100),
        nullable=True,
    )

    implementing_agency = Column(
        String(200),
        nullable=True,
    )

    # ============================================================
    # ADMINISTRATIVE LOCATION
    # ============================================================

    state = Column(
        String(100),
        nullable=True,
        index=True,
    )

    district = Column(
        String(100),
        nullable=True,
        index=True,
    )

    # ============================================================
    # REPRESENTATIVE PROJECT GIS LOCATION
    # ============================================================

    latitude = Column(
        Float,
        nullable=True,
    )

    longitude = Column(
        Float,
        nullable=True,
    )

    # ============================================================
    # PROJECT START LOCATION
    # ============================================================

    start_location = Column(
        String(255),
        nullable=True,
    )

    start_latitude = Column(
        Float,
        nullable=True,
    )

    start_longitude = Column(
        Float,
        nullable=True,
    )

    # ============================================================
    # PROJECT END LOCATION
    # ============================================================

    end_location = Column(
        String(255),
        nullable=True,
    )

    end_latitude = Column(
        Float,
        nullable=True,
    )

    end_longitude = Column(
        Float,
        nullable=True,
    )

    # ============================================================
    # ROUTE / CORRIDOR GEOMETRY
    # ============================================================
    #
    # Stored as GeoJSON, for example:
    #
    # {
    #     "type": "LineString",
    #     "coordinates": [
    #         [76.95, 8.52],
    #         [77.01, 8.58]
    #     ]
    # }
    #
    # GeoJSON coordinates are:
    #
    # [longitude, latitude]
    #
    # ============================================================

    route_geometry = Column(
        JSONB,
        nullable=True,
    )

    # ============================================================
    # GIS ENRICHMENT METADATA
    # ============================================================

    gis_status = Column(
        String(30),
        nullable=True,
        index=True,
    )

    # Examples:
    #
    # EXACT
    # CORRIDOR
    # CORRIDOR_APPROX
    # LOCALITY_APPROX
    # ADMIN_AREA
    # UNRESOLVED

    location_accuracy = Column(
        String(50),
        nullable=True,
    )

    # Examples:
    #
    # official_project_data
    # Bhoomi Rashi + OpenStreetMap Nominatim
    # project_name + OpenStreetMap Nominatim

    location_source = Column(
        String(150),
        nullable=True,
    )

    geocode_confidence = Column(
        Float,
        nullable=True,
    )

    # ============================================================
    # LAND ACQUISITION
    # ============================================================

    total_land_area = Column(
        Float,
        nullable=True,
    )

    acquired_land_area = Column(
        Float,
        nullable=True,
    )

    remaining_land_area = Column(
        Float,
        nullable=True,
    )

    # ============================================================
    # CURRENT PROJECT STATUS
    # ============================================================

    current_stage = Column(
        String(100),
        nullable=True,
    )

    # ============================================================
    # LEGACY / SAVED RISK VALUES
    # ============================================================
    #
    # These are retained because they already exist in the
    # projects table.
    #
    # Current UI prediction information may instead come from
    # the latest record in the predictions table.
    #
    # ============================================================

    risk_score = Column(
        Float,
        nullable=True,
    )

    delay_probability = Column(
        Float,
        nullable=True,
    )

    predicted_delay_days = Column(
        Float,
        nullable=True,
    )

    # ============================================================
    # STATUS
    # ============================================================

    is_active = Column(
        Boolean,
        nullable=False,
        default=True,
    )

    # ============================================================
    # NOTES / SOURCE METADATA
    # ============================================================

    notes = Column(
        Text,
        nullable=True,
    )

    # ============================================================
    # TIMESTAMPS
    # ============================================================

    created_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )

    updated_at = Column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    # ============================================================
    # REPRESENTATION
    # ============================================================

    def __repr__(self) -> str:
        return (
            f"<Project("
            f"id={self.id}, "
            f"project_id='{self.project_id}', "
            f"project_name='{self.project_name}'"
            f")>"
        )