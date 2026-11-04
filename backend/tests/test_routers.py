from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from backend.app.routers.dashboard import get_dashboard_summary
from backend.app.routers.reports import (
    get_financial_reports,
    get_income_statement,
    get_balance_sheet,
    get_cash_flow,
)
from backend.app.routers.closing import get_closing_reconciliation
from backend.app.routers.kbr import kbr_engine_status, run_kbr_diagnosis
from backend.app.schemas import FinancialReportRequest
from backend.tests.test_finance import workspace_fixture


class RouterEndpointsDirectTests(unittest.TestCase):
    def setUp(self) -> None:
        self.request = FinancialReportRequest(
            month="2026-09",
            workspace=workspace_fixture(),
        )

    def test_dashboard_router_returns_kpi_and_allocations(self) -> None:
        result = get_dashboard_summary(self.request)
        self.assertEqual(result["month"], "2026-09")
        self.assertIn("kpi", result)
        self.assertIn("trend", result)
        self.assertIn("revenueAllocation", result)
        self.assertEqual(result["kpi"]["revenue"], 100_000_000)
        self.assertIn("cashRunwayMonths", result["kpi"])
        self.assertIn("cashRunwayDays", result["kpi"])
        self.assertEqual(len(result["trend"]), 6)

    def test_reports_router_returns_full_sak_emkm(self) -> None:
        result = get_financial_reports(self.request)
        self.assertIn("report", result)
        self.assertIn("trend", result)

    def test_income_statement_router(self) -> None:
        result = get_income_statement(self.request)
        self.assertEqual(result["period"], "2026-09")
        self.assertEqual(result["revenue"], 100_000_000)
        self.assertIn("operatingProfit", result)
        self.assertIn("netProfit", result)

    def test_balance_sheet_router(self) -> None:
        result = get_balance_sheet(self.request)
        self.assertEqual(result["period"], "2026-09")
        self.assertTrue(result["isBalanced"])
        self.assertIn("currentAssets", result["assets"])
        self.assertIn("equity", result)

    def test_cash_flow_router(self) -> None:
        result = get_cash_flow(self.request)
        self.assertEqual(result["period"], "2026-09")
        self.assertIn("operatingCashFlow", result)
        self.assertIn("closingCash", result)

    def test_closing_reconciliation_router(self) -> None:
        result = get_closing_reconciliation(self.request)
        self.assertEqual(result["period"], "2026-09")
        self.assertIn("reconciliation", result)
        self.assertIn("inventory", result)

    def test_kbr_status_router(self) -> None:
        result = kbr_engine_status()
        self.assertTrue(result["ok"])
        self.assertEqual(result["engine"], "OWL + SWRL / Pellet")

    def test_kbr_diagnosis_router(self) -> None:
        result = run_kbr_diagnosis(self.request)
        self.assertIn("level", result)
        self.assertIn("status_label", result)
        self.assertIn("recommendations", result)
        self.assertEqual(result["period"], "2026-09")


if __name__ == "__main__":
    unittest.main()
