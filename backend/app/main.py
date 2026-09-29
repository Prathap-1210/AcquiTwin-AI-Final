from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings


# ============================================================
# PROJECT MANAGEMENT
# ============================================================

from app.api.routes.projects import (
    router as projects_router,
)


# ============================================================
# ACQUITWIN COPILOT
# ============================================================

from app.api.routes.copilot import (
    router as copilot_router,
)


# ============================================================
# PROJECT DELAY PREDICTION
# ============================================================

from app.api.routes.predictions import (
    router as predictions_router,
)

from app.api.routes.prediction_history import (
    router as prediction_history_router,
)


# ============================================================
# WHAT-IF SIMULATION AND INTERVENTIONS
# ============================================================

from app.api.routes.what_if import (
    router as what_if_router,
)

from app.api.routes.interventions import (
    router as interventions_router,
)


# ============================================================
# STAGE INTELLIGENCE
# ============================================================

from app.api.routes.stage_delay import (
    router as stage_delay_router,
)

from app.api.routes.stage_events import (
    router as stage_events_router,
)

from app.api.routes.stage_bottlenecks import (
    router as stage_bottlenecks_router,
)

from app.api.routes.stage_readiness import (
    router as stage_readiness_router,
)


# ============================================================
# DOCUMENT INTELLIGENCE
# ============================================================

from app.api.routes.document_ai import (
    router as document_ai_router,
)


# ============================================================
# FASTAPI APPLICATION
# ============================================================

app = FastAPI(
    title="AcquiTwin AI API",
    description=(
        "AI-powered land acquisition intelligence platform for "
        "early detection and analysis of land acquisition delays. "
        "The platform includes project-delay prediction, prediction "
        "history, what-if simulation, intervention scenarios, stage "
        "delay analysis, stage event management, bottleneck detection, "
        "stage data readiness analysis, AI-powered document intelligence, "
        "and the AcquiTwin Copilot."
    ),
    version="1.2.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)


# ============================================================
# CORS CONFIGURATION
# ============================================================

frontend_origin = settings.frontend_url.rstrip("/")

allowed_origins = [
    # Local Vite development
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:5176",

    "http://127.0.0.1:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:5175",
    "http://127.0.0.1:5176",

    # Production frontend from Railway FRONTEND_URL
    frontend_origin,
]

# Remove duplicates while preserving order
allowed_origins = list(
    dict.fromkeys(allowed_origins)
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# ROOT ENDPOINT
# ============================================================

@app.get("/")
def root():
    return {
        "success": True,
        "message": "AcquiTwin AI API is running.",
        "version": "1.2.0",
        "environment": settings.app_env,
        "modules": [
            "Project Management",
            "Project Delay Prediction",
            "Prediction History",
            "What-If Simulation",
            "Intervention Engine",
            "Stage Delay Prediction",
            "Stage Event Management",
            "Stage Bottleneck Detection",
            "Stage Data Readiness",
            "Document Intelligence",
            "AcquiTwin Copilot",
        ],
    }


# ============================================================
# HEALTH ENDPOINT
# ============================================================

@app.get("/health")
def health():
    return {
        "success": True,
        "status": "healthy",
        "service": "AcquiTwin AI API",
        "version": "1.2.0",
        "environment": settings.app_env,
    }


# ============================================================
# REGISTER PROJECT MANAGEMENT
# ============================================================

app.include_router(
    projects_router
)


# ============================================================
# REGISTER PROJECT DELAY PREDICTION
# ============================================================

app.include_router(
    predictions_router
)

app.include_router(
    prediction_history_router
)


# ============================================================
# REGISTER WHAT-IF SIMULATOR
# ============================================================

app.include_router(
    what_if_router
)


# ============================================================
# REGISTER INTERVENTION SCENARIO ENGINE
# ============================================================

app.include_router(
    interventions_router
)


# ============================================================
# REGISTER STAGE DELAY PREDICTION
# ============================================================

app.include_router(
    stage_delay_router
)


# ============================================================
# REGISTER STAGE EVENT MANAGEMENT
# ============================================================

app.include_router(
    stage_events_router
)


# ============================================================
# REGISTER STAGE BOTTLENECK DETECTION
# ============================================================

app.include_router(
    stage_bottlenecks_router
)


# ============================================================
# REGISTER STAGE DATA READINESS
# ============================================================

app.include_router(
    stage_readiness_router
)


# ============================================================
# REGISTER DOCUMENT INTELLIGENCE
# ============================================================

app.include_router(
    document_ai_router
)


# ============================================================
# REGISTER ACQUITWIN COPILOT
# ============================================================

app.include_router(
    copilot_router
)