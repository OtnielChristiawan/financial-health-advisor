from __future__ import annotations

import re
from typing import Any
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .finance import FinanceWorkspace


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
    model_config = ConfigDict(extra="ignore")

    month: str
    workspace: FinanceWorkspace
    include_diagnosis: bool = False

    @field_validator("month")
    @classmethod
    def month_must_be_valid(cls, value: str) -> str:
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value):
            raise ValueError("Periode harus menggunakan format YYYY-MM.")
        return value

