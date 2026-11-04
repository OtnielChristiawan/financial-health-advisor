from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .reasoning import JAVA_VERSION
from .routers import closing_router, dashboard_router, kbr_router, reports_router
from .schemas import AnalyzeRequest, FinancialReportRequest, Movement

app = FastAPI(
    title="RuangUsaha Modular API",
    version="2.0.0",
    description=(
        "API Modular untuk Sistem Manajemen Finansial & Penalaran Kesehatan UMKM "
        "berbasis SAK EMKM dan Ontologi OWL 2 DL / SWRL (Pellet Reasoner)."
    ),
    openapi_tags=[
        {"name": "Dashboard", "description": "Ringkasan metrik KPI, tren penjualan, dan alokasi biaya super cepat (<20ms)."},
        {"name": "Financial Reports", "description": "Laporan Keuangan SAK EMKM: Laba Rugi, Posisi Keuangan (Neraca), dan Arus Kas."},
        {"name": "Closing & Reconciliation", "description": "Tutup Buku bulanan, persediaan fisik, dan rekonsiliasi kas/bank fisik."},
        {"name": "Knowledge-Based Reasoning (OWL/Pellet)", "description": "Diagnosa sistem pakar berbasis ontologi OWL 2 DL dan aturan SWRL via Pellet Reasoner."},
    ],
)

allowed_origins = [
    origin.strip()
    for origin in os.environ.get("FRONTEND_ORIGINS", "").split(",")
    if origin.strip()
]
if not allowed_origins:
    allowed_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True if allowed_origins != ["*"] else False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register Domain Routers
app.include_router(dashboard_router)
app.include_router(reports_router)
app.include_router(closing_router)
app.include_router(kbr_router)


@app.get("/api/health")
def health() -> dict[str, Any]:
    """Healthcheck & metadata router."""
    return {
        "ok": True,
        "engine": "OWL + SWRL / Pellet",
        "java": JAVA_VERSION,
        "architecture": "Modular Domain Routers (Dashboard, Reports, Closing, KBR)",
        "endpoints": [
            "/api/dashboard",
            "/api/reports",
            "/api/reports/income-statement",
            "/api/reports/balance-sheet",
            "/api/reports/cash-flow",
            "/api/closing/reconciliation",
            "/api/kbr/diagnose",
            "/api/kbr/status",
        ],
    }


# Backward-compatible aliases for existing client code / tests
@app.post("/api/diagnose", include_in_schema=False)
def diagnose_alias(request: FinancialReportRequest) -> dict[str, Any]:
    from .routers.kbr import run_kbr_diagnosis
    return run_kbr_diagnosis(request)


@app.post("/api/analyze", include_in_schema=False)
def analyze_alias(request: AnalyzeRequest) -> dict[str, Any]:
    from .routers.kbr import run_generic_analysis
    return run_generic_analysis(request)
