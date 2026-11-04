from __future__ import annotations

from typing import Any
from fastapi import APIRouter, HTTPException

from ..finance import build_financial_report
from ..reasoning import diagnose_finance
from ..schemas import FinancialReportRequest

router = APIRouter(prefix="/api/reports", tags=["Financial Reports"])


@router.post("")
@router.post("/")
def get_financial_reports(
    request: FinancialReportRequest,
    include_diagnosis: bool = False,
) -> dict[str, Any]:
    """Mengembalikan laporan keuangan lengkap standar SAK EMKM:
    - Laporan Laba Rugi
    - Laporan Posisi Keuangan (Neraca)
    - Laporan Arus Kas
    - Tren 6 Bulan
    
    Jika `include_diagnosis` = True, juga menyertakan diagnosa KBR ontologi.
    """
    try:
        data = build_financial_report(request.workspace, request.month)
        should_diagnose = include_diagnosis or request.include_diagnosis
        if should_diagnose:
            data["diagnosis"] = diagnose_finance(data["report"])
        return data
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/income-statement")
def get_income_statement(request: FinancialReportRequest) -> dict[str, Any]:
    """Endpoint spesifik: Laporan Laba Rugi SAK EMKM."""
    try:
        data = build_financial_report(request.workspace, request.month)
        report = data["report"]
        return {
            "period": request.month,
            "revenue": report["revenue"],
            "cogs": report["cogs"],
            "grossProfit": report["grossProfit"],
            "grossMargin": report["grossMargin"],
            "operatingExpense": report["opex"],
            "operatingExpenseDetail": report.get("opexBreakdown", {}),
            "operatingProfit": report["operatingProfit"],
            "nonOperatingIncome": report["nonOperatingIncome"],
            "nonOperatingExpense": report["nonOperatingExpense"],
            "netProfit": report["netProfit"],
            "netMargin": report["netMargin"],
            "isClosed": report["isClosed"],
            "closingStatus": report["closingStatus"],
        }
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/balance-sheet")
def get_balance_sheet(request: FinancialReportRequest) -> dict[str, Any]:
    """Endpoint spesifik: Laporan Posisi Keuangan (Neraca) SAK EMKM."""
    try:
        data = build_financial_report(request.workspace, request.month)
        report = data["report"]
        return {
            "period": request.month,
            "assets": {
                "currentAssets": {
                    "cash": report["cash"],
                    "bank": report["bank"],
                    "inventory": report["inventory"],
                    "total": report["cash"] + report["bank"] + report["inventory"],
                },
                "fixedAssets": {
                    "acquisitionCost": report["fixedAssets"],
                    "accumulatedDepreciation": report["accumulatedDepreciation"],
                    "bookValue": report["fixedAssets"] - report["accumulatedDepreciation"],
                },
                "totalAssets": report["assetsTotal"],
            },
            "liabilities": {
                "totalLiabilities": report["liabilities"],
            },
            "equity": {
                "capitalInjections": report["capitalInjections"],
                "cumulativeNetProfit": report["cumulativeNetProfit"],
                "ownerDraw": report["ownerDraw"],
                "totalEquity": report["equity"],
            },
            "balanceDifference": report["balanceDifference"],
            "isBalanced": abs(report["balanceDifference"]) < 1.0,
        }
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/cash-flow")
def get_cash_flow(request: FinancialReportRequest) -> dict[str, Any]:
    """Endpoint spesifik: Laporan Arus Kas SAK EMKM."""
    try:
        data = build_financial_report(request.workspace, request.month)
        report = data["report"]
        return {
            "period": request.month,
            "operatingCashFlow": report["operatingCashFlow"],
            "investingCashFlow": report["investingCashFlow"],
            "financingCashFlow": report["financingCashFlow"],
            "netCashChange": report["changeCash"],
            "openingCash": report["cashOpening"],
            "closingCash": report["cashClosing"],
        }
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
