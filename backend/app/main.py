from __future__ import annotations

import os
import re
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .finance import FinanceWorkspace, build_financial_report
from .reasoning import JAVA_VERSION, analyze


class Movement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)
    growth: float
    is_top: bool

    @field_validator("growth")
    @classmethod
    def growth_must_be_finite(cls, value: float) -> float:
        if not (-1e12 < value < 1e12):
            raise ValueError("Pertumbuhan kategori harus berupa angka finite.")
        return value


class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    numbers: dict[str, float] = Field(default_factory=dict)
    movements: list[Movement] = Field(default_factory=list, max_length=30)

    @field_validator("numbers")
    @classmethod
    def indicators_must_be_finite(cls, values: dict[str, float]) -> dict[str, float]:
        for key, value in values.items():
            if not (-1e15 < value < 1e15):
                raise ValueError(f"Nilai {key} harus finite dan dalam rentang yang didukung.")
        return values


class FinancialReportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    month: str
    workspace: FinanceWorkspace

    @field_validator("month")
    @classmethod
    def month_must_be_valid(cls, value: str) -> str:
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value):
            raise ValueError("Periode harus menggunakan format YYYY-MM.")
        return value


app = FastAPI(
    title="RuangUsaha API",
    version="1.0.0",
    description="API untuk analisis finansial UMKM berbasis OWL/SWRL dan Pellet.",
)

allowed_origins = [
    origin.strip()
    for origin in os.environ.get("FRONTEND_ORIGINS", "").split(",")
    if origin.strip()
]
if allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "engine": "OWL + SWRL / Pellet", "java": JAVA_VERSION}


@app.post("/api/reports")
def financial_report(request: FinancialReportRequest) -> dict[str, Any]:
    try:
        return build_financial_report(request.workspace, request.month)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/analyze")
def analyze_financial_state(request: AnalyzeRequest) -> dict[str, Any]:
    try:
        return analyze(request.model_dump())
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
