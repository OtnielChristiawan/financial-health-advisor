from __future__ import annotations

import unittest

from pydantic import ValidationError

from backend.app.finance import FinanceWorkspace, build_financial_report


def workspace_fixture() -> dict:
    return {
        "opening": {
            "date": "2026-07-31",
            "cash": 12_000_000,
            "bank": 15_000_000,
            "fixedAssets": 0,
            "liabilities": 5_000_000,
            "equity": 22_000_000,
            "confirmed": True,
        },
        "transactions": [
            {"id": "aug-sales", "date": "2026-08-03", "description": "Penjualan Agustus", "kind": "revenue", "category": "Penjualan", "amount": 90_000_000, "account": "cash"},
            {"id": "aug-cogs", "date": "2026-08-05", "description": "HPP Agustus", "kind": "expense", "category": "COGS / HPP", "amount": 38_000_000, "account": "cash"},
            {"id": "sep-sales", "date": "2026-09-03", "description": "Penjualan September", "kind": "revenue", "category": "Penjualan", "amount": 100_000_000, "account": "cash"},
            {"id": "sep-cogs", "date": "2026-09-05", "description": "HPP September", "kind": "expense", "category": "COGS / HPP", "amount": 46_500_000, "account": "cash"},
            {"id": "sep-capital", "date": "2026-09-07", "description": "Setoran modal", "kind": "capital", "category": "Setoran modal pemilik", "amount": 10_000_000, "account": "cash"},
            {"id": "sep-draw", "date": "2026-09-18", "description": "Prive", "kind": "draw", "category": "Prive / pengambilan pribadi", "amount": 8_000_000, "account": "cash"},
            {"id": "sep-asset", "date": "2026-09-12", "description": "Mesin", "kind": "asset", "category": "Aset tetap", "amount": 12_000_000, "account": "cash", "assetId": "espresso"},
        ],
        "assets": [
            {"id": "espresso", "name": "Mesin", "cost": 12_000_000, "residual": 0, "lifeMonths": 12, "startDate": "2026-09-12", "account": "cash", "opening": False},
        ],
    }


class FinancialReportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.workspace = FinanceWorkspace.model_validate(workspace_fixture())

    def test_owner_capital_increases_cash_and_equity_not_revenue_or_profit(self) -> None:
        report = build_financial_report(self.workspace, "2026-09")["report"]
        without_capital = self.workspace.model_copy(
            update={
                "transactions": [
                    transaction
                    for transaction in self.workspace.transactions
                    if transaction.kind != "capital"
                ]
            }
        )
        baseline = build_financial_report(without_capital, "2026-09")["report"]
        self.assertEqual(report["revenue"], baseline["revenue"])
        self.assertEqual(report["netProfit"], baseline["netProfit"])
        self.assertEqual(report["cash"], baseline["cash"] + 10_000_000)
        self.assertEqual(report["equity"], baseline["equity"] + 10_000_000)

    def test_reports_separate_operating_investing_and_financing_cash(self) -> None:
        report = build_financial_report(self.workspace, "2026-09")["report"]
        self.assertEqual(report["operatingCashFlow"], 100_000_000 - 46_500_000)
        self.assertEqual(report["investingCashFlow"], -12_000_000)
        self.assertEqual(report["financingCashFlow"], 10_000_000 - 8_000_000)
        self.assertEqual(report["changeCash"], 43_500_000)

    def test_report_includes_previous_month_rows_for_reasoning(self) -> None:
        report = build_financial_report(self.workspace, "2026-09")["report"]
        self.assertEqual(report["previous"]["revenue"], 90_000_000)
        self.assertEqual(report["previous"]["rows"][0]["id"], "aug-sales")

    def test_trend_contains_six_months_in_chronological_order(self) -> None:
        result = build_financial_report(self.workspace, "2026-09")
        self.assertEqual(
            [entry["month"] for entry in result["trend"]],
            ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"],
        )

    def test_opening_balances_reject_negative_values(self) -> None:
        with self.assertRaises(ValidationError):
            FinanceWorkspace.model_validate({**workspace_fixture(), "opening": {**workspace_fixture()["opening"], "cash": -1}})

    def test_asset_residual_cannot_exceed_cost(self) -> None:
        workspace = workspace_fixture()
        workspace["assets"][0]["residual"] = workspace["assets"][0]["cost"] + 1
        with self.assertRaisesRegex(ValueError, "Nilai residu aset"):
            build_financial_report(FinanceWorkspace.model_validate(workspace), "2026-09")


if __name__ == "__main__":
    unittest.main()
