from __future__ import annotations

import unittest

from pydantic import ValidationError

from backend.app.finance import FinanceWorkspace, build_financial_report
from backend.app.reasoning import diagnose_finance, analyze


def workspace_fixture() -> dict:
    return {
        "opening": {
            "date": "2026-07-31",
            "cash": 12_000_000,
            "bank": 15_000_000,
            "inventory": 0,
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
        "customCategories": [],
        "closings": [],
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

    def test_opening_balances_validate_accounting_equation(self) -> None:
        unbalanced = workspace_fixture()
        # cash=12M + bank=15M = 27M assets, but liab=5M + equity=20M = 25M
        unbalanced["opening"]["equity"] = 20_000_000
        unbalanced["opening"]["confirmed"] = True
        with self.assertRaisesRegex(ValidationError, "Saldo awal tidak seimbang"):
            FinanceWorkspace.model_validate(unbalanced)

    def test_asset_residual_cannot_exceed_cost(self) -> None:
        workspace = workspace_fixture()
        workspace["assets"][0]["residual"] = workspace["assets"][0]["cost"] + 1
        with self.assertRaisesRegex(ValueError, "Nilai residu aset"):
            build_financial_report(FinanceWorkspace.model_validate(workspace), "2026-09")

    def test_transfer_moves_balance_between_cash_and_bank_without_changing_total_cash_flow(self) -> None:
        workspace = workspace_fixture()
        baseline = build_financial_report(FinanceWorkspace.model_validate(workspace), "2026-09")["report"]
        workspace["transactions"].append({
            "id": "sep-transfer",
            "date": "2026-09-20",
            "description": "Setor tunai ke rekening",
            "kind": "transfer",
            "category": "Perpindahan saldo",
            "amount": 2_000_000,
            "account": "cash",
            "transferTo": "bank",
        })

        report = build_financial_report(FinanceWorkspace.model_validate(workspace), "2026-09")["report"]

        self.assertEqual(report["cash"], baseline["cash"] - 2_000_000)
        self.assertEqual(report["bank"], baseline["bank"] + 2_000_000)
        self.assertEqual(report["cashClosing"], baseline["cashClosing"])
        self.assertEqual(report["changeCash"], baseline["changeCash"])
        self.assertEqual(report["balanceDifference"], 0)

    def test_transfer_requires_a_different_destination_account(self) -> None:
        workspace = workspace_fixture()
        workspace["transactions"].append({
            "id": "invalid-transfer",
            "date": "2026-09-20",
            "description": "Transfer tidak valid",
            "kind": "transfer",
            "category": "Perpindahan saldo",
            "amount": 2_000_000,
            "account": "cash",
            "transferTo": "cash",
        })

        with self.assertRaises(ValidationError):
            FinanceWorkspace.model_validate(workspace)

    def test_opex_subcategories_and_breakdown(self) -> None:
        workspace = workspace_fixture()
        workspace["transactions"].extend([
            {"id": "sep-payroll", "date": "2026-09-08", "description": "Gaji barista", "kind": "expense", "category": "Beban Pegawai (Gaji, THR, BPJS)", "amount": 15_000_000, "account": "cash"},
            {"id": "sep-util", "date": "2026-09-09", "description": "Listrik & air", "kind": "expense", "category": "Beban Utilitas & Tempat (Listrik, Air, Sewa)", "amount": 5_000_000, "account": "cash"},
            {"id": "sep-ops", "date": "2026-09-10", "description": "Cup & sedotan", "kind": "expense", "category": "Beban Operasional & Umum (Supplies, ATK)", "amount": 3_000_000, "account": "cash"},
            {"id": "sep-maint", "date": "2026-09-11", "description": "Servis grinder", "kind": "expense", "category": "Beban Pemeliharaan (Servis Mesin, AC)", "amount": 2_000_000, "account": "cash"},
            {"id": "sep-mkt", "date": "2026-09-15", "description": "Promo IG & MDR", "kind": "expense", "category": "Beban Pemasaran (Iklan, Promo, MDR)", "amount": 4_000_000, "account": "cash"},
        ])
        report = build_financial_report(FinanceWorkspace.model_validate(workspace), "2026-09")["report"]
        self.assertEqual(report["opexBreakdown"]["payroll"], 15_000_000)
        self.assertEqual(report["opexBreakdown"]["utilities"], 5_000_000)
        self.assertEqual(report["opexBreakdown"]["operational"], 3_000_000)
        self.assertEqual(report["opexBreakdown"]["marketing"], 4_000_000)
        self.assertEqual(report["opexBreakdown"]["maintenance"], 2_000_000)
        self.assertEqual(report["opex"], 29_000_000)
        self.assertEqual(report["marketing"], 4_000_000)

    def test_custom_category_opex_is_not_dropped(self) -> None:
        """Verifies bug fix: custom categories with parent='opex' must not be dropped from Income Statement."""
        workspace = workspace_fixture()
        workspace["customCategories"] = [{"id": "c1", "name": "Gas Elpiji", "parent": "opex", "kind": "expense"}]
        workspace["transactions"].append({
            "id": "sep-gas", "date": "2026-09-10", "description": "Beli gas", "kind": "expense",
            "category": "Gas Elpiji", "amount": 600_000, "account": "cash"
        })
        rep = build_financial_report(FinanceWorkspace.model_validate(workspace), "2026-09")["report"]
        self.assertEqual(rep["opexBreakdown"]["general"], 600_000)
        self.assertEqual(rep["opex"], 600_000)
        self.assertEqual(rep["balanceDifference"], 0)

    def test_unmapped_category_is_captured_in_opex(self) -> None:
        """Ensures that any expense with an unmapped category is safely captured and never omitted."""
        workspace = workspace_fixture()
        workspace["transactions"].append({
            "id": "sep-mystery", "date": "2026-09-11", "description": "Biaya Lain", "kind": "expense",
            "category": "Kategori Tidak Terdaftar", "amount": 450_000, "account": "cash"
        })
        rep = build_financial_report(FinanceWorkspace.model_validate(workspace), "2026-09")["report"]
        self.assertIn(450_000, [rep["opex"], rep["opexBreakdown"]["general"]])
        self.assertEqual(rep["balanceDifference"], 0)

    def test_periodic_inventory_cogs_calculation(self) -> None:
        """
        Beginning Inventory = Rp3,000,000.
        Net Purchases = Rp12,000,000.
        Ending Inventory = Rp4,000,000.
        Expected Raw Material Consumption (COGS) = Rp11,000,000.
        """
        workspace = {
            "opening": {
                "date": "2026-07-31",
                "cash": 20_000_000,
                "bank": 0,
                "inventory": 3_000_000,
                "fixedAssets": 0,
                "liabilities": 0,
                "equity": 23_000_000,
                "confirmed": True,
            },
            "transactions": [
                {"id": "t1", "date": "2026-08-01", "description": "Penjualan", "kind": "revenue", "category": "Penjualan", "amount": 25_000_000, "account": "cash"},
                {"id": "t2", "date": "2026-08-05", "description": "Beli Daging & Tepung", "kind": "expense", "category": "Pembelian Bahan Baku", "amount": 12_000_000, "account": "cash"},
            ],
            "assets": [],
            "closings": [{
                "period": "2026-08",
                "status": "closed",
                "stockOpnameDate": "2026-08-31",
                "openingInventory": 3_000_000,
                "purchases": 12_000_000,
                "endingInventory": 4_000_000,
                "rawMaterialConsumption": 11_000_000,
                "notes": "Stock opname Agustus",
            }],
        }
        rep = build_financial_report(FinanceWorkspace.model_validate(workspace), "2026-08")["report"]
        self.assertEqual(rep["openingInventory"], 3_000_000)
        self.assertEqual(rep["ingredientPurchases"], 12_000_000)
        self.assertEqual(rep["endingInventory"], 4_000_000)
        self.assertEqual(rep["cogs"], 11_000_000)
        self.assertEqual(rep["grossProfit"], 25_000_000 - 11_000_000)
        self.assertEqual(rep["inventory"], 4_000_000)
        self.assertEqual(rep["balanceDifference"], 0)
        self.assertTrue(rep["isClosed"])
        self.assertFalse(rep["isProvisional"])

    def test_stock_opname_ending_inventory_rejects_exceeding_available(self) -> None:
        """Ending inventory cannot exceed available inventory (Opening + Purchases) without documented adjustment."""
        workspace = workspace_fixture()
        workspace["closings"] = [{
            "period": "2026-09",
            "status": "closed",
            "stockOpnameDate": "2026-09-30",
            "openingInventory": 0,
            "purchases": 10_000_000,
            "endingInventory": 15_000_000,  # Exceeds 10M
            "rawMaterialConsumption": 0,
        }]
        with self.assertRaisesRegex(ValidationError, "Persediaan akhir .* tidak boleh melebihi persediaan yang tersedia"):
            FinanceWorkspace.model_validate(workspace)

    def test_balance_sheet_equation_invariant(self) -> None:
        """Assets == Liabilities + Equity must hold with zero difference across multiple months."""
        rep_aug = build_financial_report(self.workspace, "2026-08")["report"]
        rep_sep = build_financial_report(self.workspace, "2026-09")["report"]
        self.assertEqual(rep_aug["balanceDifference"], 0)
        self.assertEqual(rep_sep["balanceDifference"], 0)
        self.assertEqual(rep_sep["assetsTotal"], rep_sep["liabilities"] + rep_sep["equity"])

    def test_cash_flow_reconciliation(self) -> None:
        """Beginning Cash + Net Cash Flow = Ending Cash."""
        rep = build_financial_report(self.workspace, "2026-09")["report"]
        self.assertEqual(rep["cashOpening"] + rep["changeCash"], rep["cashClosing"])

    def test_loan_and_principal_repayments(self) -> None:
        workspace = workspace_fixture()
        workspace["transactions"].extend([
            {"id": "sep-loan", "date": "2026-09-10", "description": "Pinjaman KUR", "kind": "loan", "category": "Penerimaan pinjaman", "amount": 20_000_000, "account": "bank"},
            {"id": "sep-princ", "date": "2026-09-25", "description": "Cicilan pokok KUR", "kind": "principal", "category": "Pembayaran pokok pinjaman", "amount": 2_000_000, "account": "bank"},
        ])
        rep = build_financial_report(FinanceWorkspace.model_validate(workspace), "2026-09")["report"]
        # Loan adds 20M, principal reduces 2M -> net +18M liabilities
        self.assertEqual(rep["liabilities"], 5_000_000 + 18_000_000)
        self.assertEqual(rep["balanceDifference"], 0)

    def test_diagnose_finance_detects_cost_escalation_and_margin_pressure(self) -> None:
        rep = build_financial_report(self.workspace, "2026-09")["report"]
        diag = diagnose_finance(rep)
        self.assertEqual(diag["status"], "WASPADA")
        self.assertEqual(diag["level"], "danger")
        finding_ids = [f["id"] for f in diag["findings"]]
        self.assertIn("CostEscalation", finding_ids)
        self.assertIn("MarginPressure", finding_ids)
        self.assertIn("COGS", diag["cost_drivers"])

    def test_diagnose_finance_data_tidak_cukup_on_incomplete_data(self) -> None:
        workspace = {
            "opening": {"date": "2026-08-31", "cash": 5_000_000, "bank": 0, "inventory": 0, "fixedAssets": 0, "liabilities": 0, "equity": 5_000_000, "confirmed": True},
            "transactions": [
                {"id": "t1", "date": "2026-09-01", "description": "Jual", "kind": "revenue", "category": "Penjualan", "amount": 10_000_000, "account": "cash"}
            ],
            "assets": [],
        }
        rep = build_financial_report(FinanceWorkspace.model_validate(workspace), "2026-09")["report"]
        diag = diagnose_finance(rep)
        self.assertEqual(diag["status"], "DATA_TIDAK_CUKUP")
        self.assertEqual(diag["level"], "limited")

    def test_diagnose_finance_liquidity_critical_with_low_runway(self) -> None:
        workspace = {
            "opening": {"date": "2026-07-31", "cash": 2_000_000, "bank": 0, "inventory": 0, "fixedAssets": 0, "liabilities": 0, "equity": 2_000_000, "confirmed": True},
            "transactions": [
                {"id": "aug-sales", "date": "2026-08-01", "description": "Jual", "kind": "revenue", "category": "Penjualan", "amount": 10_000_000, "account": "cash"},
                {"id": "aug-exp", "date": "2026-08-05", "description": "Beban", "kind": "expense", "category": "OPEX", "amount": 8_000_000, "account": "cash"},
                {"id": "sep-sales", "date": "2026-09-01", "description": "Jual", "kind": "revenue", "category": "Penjualan", "amount": 2_000_000, "account": "cash"},
                {"id": "sep-exp", "date": "2026-09-05", "description": "Beban", "kind": "expense", "category": "OPEX", "amount": 8_000_000, "account": "cash"},
            ],
            "assets": [],
        }
        rep = build_financial_report(FinanceWorkspace.model_validate(workspace), "2026-09")["report"]
        diag = diagnose_finance(rep)
        self.assertEqual(diag["status"], "KRITIS")
        self.assertEqual(diag["level"], "critical")
        finding_ids = [f["id"] for f in diag["findings"]]
        self.assertIn("LiquidityCritical", finding_ids)


if __name__ == "__main__":
    unittest.main()

