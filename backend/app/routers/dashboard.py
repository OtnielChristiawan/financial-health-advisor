from __future__ import annotations

from typing import Any
from fastapi import APIRouter, HTTPException

from ..finance import build_financial_report
from ..schemas import FinancialReportRequest

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.post("")
@router.post("/")
def get_dashboard_summary(request: FinancialReportRequest) -> dict[str, Any]:
    """Mengembalikan data ringkas khusus untuk halaman Dashboard UMKM.
    
    Dirancang untuk respon super cepat (<20ms) dengan menghitung indikator SAK EMKM
    tanpa memblokir thread dengan eksekusi reasoner ontologi Pellet Java.
    """
    try:
        data = build_financial_report(request.workspace, request.month)
        report = data["report"]
        trend = data["trend"]

        previous = report.get("previous") or {}
        prev_revenue = previous.get("revenue") or 0.0
        rev_growth = (
            ((report["revenue"] - prev_revenue) / prev_revenue * 100.0)
            if prev_revenue > 0
            else 0.0
        )

        opex_breakdown = report.get("opexBreakdown") or {}

        return {
            "month": request.month,
            "kpi": {
                "revenue": report["revenue"],
                "revenueGrowth": round(rev_growth, 1),
                "grossProfit": report["grossProfit"],
                "grossMargin": report["grossMargin"],
                "netProfit": report["netProfit"],
                "netMargin": report["netMargin"],
                "totalCash": report["cash"] + report["bank"],
                "cash": report["cash"],
                "bank": report["bank"],
                "changeCash": report["changeCash"],
                "cashRunwayMonths": report["cashRunwayMonths"],
                "cashRunwayDays": report["cashRunwayDays"],
                "averageMonthlyOpex": report["averageMonthlyOpex"],
                "runwayMinimumMonths": report["runwayMinimumMonths"],
                "runwayMinimumDays": report["runwayMinimumDays"],
                "isClosed": report["isClosed"],
                "isProvisional": report["isProvisional"],
                "closingStatus": report["closingStatus"],
            },
            "trend": trend,
            "revenueAllocation": {
                "revenue": report["revenue"],
                "cogs": report["cogs"],
                "payroll": opex_breakdown.get("payroll", 0.0),
                "utilities": opex_breakdown.get("utilities", 0.0),
                "operational": opex_breakdown.get("operational", 0.0),
                "marketing": opex_breakdown.get("marketing", 0.0),
                "depreciation": report["depreciation"],
                "cashDifference": report.get("cashDifference", 0.0),
                "netProfit": report["netProfit"],
            },
            "report": report,
        }
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
