from __future__ import annotations

from typing import Any
from fastapi import APIRouter, HTTPException

from ..finance import build_financial_report
from ..schemas import FinancialReportRequest

router = APIRouter(prefix="/api/closing", tags=["Closing & Reconciliation"])


@router.post("/reconciliation")
def get_closing_reconciliation(request: FinancialReportRequest) -> dict[str, Any]:
    """Mengembalikan analisis rekonsiliasi kas, bank, dan persediaan untuk proses Tutup Buku SAK EMKM."""
    try:
        data = build_financial_report(request.workspace, request.month)
        report = data["report"]

        system_cash = report.get("systemCash", report["cash"])
        system_bank = report.get("systemBank", report["bank"])
        actual_cash = report.get("actualCash")
        actual_bank = report.get("actualBank")
        cash_diff = report.get("cashDifference", 0.0)
        treatment = report.get("differenceTreatment", "opex")

        journal_recommendations = []
        if actual_cash is not None or actual_bank is not None:
            if cash_diff > 0:
                journal_recommendations.append({
                    "type": "Surplus (Lebih Kas)",
                    "debit": "Kas Tunai / Bank",
                    "credit": "Pendapatan Selisih Kas (Luar Usaha)",
                    "amount": cash_diff,
                    "explanation": "Uang fisik lebih banyak dari catatan sistem. Diakui sebagai Pendapatan di Luar Usaha agar tidak mengaburkan Average Order Value (AOV) penjualan utama.",
                })
            elif cash_diff < 0:
                shortage = abs(cash_diff)
                expense_account = (
                    "Beban Selisih Kas (OPEX Operasional)"
                    if treatment == "opex"
                    else "Beban Selisih Kas (Non-Operasional)"
                )
                journal_recommendations.append({
                    "type": "Defisit (Kurang Kas)",
                    "debit": expense_account,
                    "credit": "Kas Tunai / Bank",
                    "amount": shortage,
                    "explanation": "Uang fisik lebih sedikit dari catatan sistem. Diakui sebagai beban usaha perusahaan sesuai kebijakan toleransi selisih kas.",
                })

        return {
            "period": request.month,
            "status": report["closingStatus"],
            "isClosed": report["isClosed"],
            "isProvisional": report["isProvisional"],
            "inventory": {
                "assetValue": report["inventory"],
                "cogsCalculated": report["cogs"],
            },
            "reconciliation": {
                "systemCash": system_cash,
                "systemBank": system_bank,
                "systemTotal": system_cash + system_bank,
                "actualCash": actual_cash,
                "actualBank": actual_bank,
                "actualTotal": (actual_cash + actual_bank) if (actual_cash is not None and actual_bank is not None) else None,
                "cashDifference": cash_diff,
                "treatment": treatment,
                "journalRecommendations": journal_recommendations,
            },
        }
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

