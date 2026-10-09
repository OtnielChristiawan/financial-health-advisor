from __future__ import annotations

import calendar
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator


class FinanceOpening(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    date: date
    cash: StrictInt = Field(ge=0)
    bank: StrictInt = Field(ge=0)
    fixed_assets: StrictInt = Field(default=0, ge=0, alias="fixedAssets")
    liabilities: StrictInt = Field(default=0, ge=0)
    equity: StrictInt = Field(ge=0)
    confirmed: bool = False


class FinanceTransaction(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str = Field(min_length=1, max_length=100)
    date: date
    description: str = Field(min_length=1, max_length=90)
    kind: Literal["revenue", "expense", "capital", "loan", "draw", "principal", "asset", "transfer"]
    category: str = Field(min_length=1, max_length=80)
    amount: StrictInt = Field(gt=0, le=9_000_000_000_000_000)
    account: Literal["cash", "bank"]
    note: str = Field(default="", max_length=500)
    asset_id: str | None = Field(default=None, alias="assetId")
    transfer_to: Literal["cash", "bank"] | None = Field(default=None, alias="transferTo")

    @model_validator(mode="after")
    def validate_transfer_accounts(self) -> FinanceTransaction:
        if self.kind == "transfer" and self.transfer_to is None:
            raise ValueError("Akun tujuan wajib diisi untuk perpindahan saldo.")
        if self.kind == "transfer" and self.account == self.transfer_to:
            raise ValueError("Akun asal dan tujuan perpindahan saldo harus berbeda.")
        if self.kind != "transfer" and self.transfer_to is not None:
            raise ValueError("Akun tujuan hanya dapat diisi untuk perpindahan saldo.")
        return self


class FinanceAsset(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    name: str
    cost: StrictInt = Field(gt=0)
    residual: StrictInt = Field(ge=0)
    life_months: StrictInt = Field(gt=0, alias="lifeMonths")
    start_date: date = Field(alias="startDate")
    account: Literal["cash", "bank"]
    opening: bool = False


class FinanceWorkspace(BaseModel):
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    opening: FinanceOpening
    transactions: list[FinanceTransaction] = Field(max_length=100_000)
    assets: list[FinanceAsset] = Field(default_factory=list, max_length=10_000)


def _month_number(month: str) -> int:
    year, number = (int(part) for part in month.split("-"))
    return year * 12 + number - 1


def _month_string(month_number: int) -> str:
    year, zero_based_month = divmod(month_number, 12)
    return f"{year:04d}-{zero_based_month + 1:02d}"


def _month_end(month: str) -> date:
    year, number = (int(part) for part in month.split("-"))
    return date(year, number, calendar.monthrange(year, number)[1])


def _amount(transactions: list[FinanceTransaction], predicate: Any) -> int:
    return sum(transaction.amount for transaction in transactions if predicate(transaction))


def _cash_delta(transaction: FinanceTransaction) -> int:
    return transaction.amount if transaction.kind in {"revenue", "capital", "loan"} else -transaction.amount


def _account_delta(transaction: FinanceTransaction, account: str) -> int:
    if transaction.kind == "transfer":
        if transaction.account == account:
            return -transaction.amount
        if transaction.transfer_to == account:
            return transaction.amount
        return 0
    return _cash_delta(transaction) if transaction.account == account else 0


def _monthly_depreciation(assets: list[FinanceAsset], month: str) -> float:
    end_date = _month_end(month)
    month_number = _month_number(month)
    total = 0.0
    for asset in assets:
        if asset.residual > asset.cost:
            raise ValueError(f"Nilai residu aset {asset.name} tidak boleh melebihi biaya perolehan.")
        if asset.start_date > end_date:
            continue
        started_month = _month_number(asset.start_date.strftime("%Y-%m"))
        elapsed = month_number - started_month
        if 0 <= elapsed < asset.life_months:
            total += (asset.cost - asset.residual) / asset.life_months
    return total


def _report_base(workspace: FinanceWorkspace, month: str) -> dict[str, Any]:
    rows = [transaction for transaction in workspace.transactions if transaction.date.strftime("%Y-%m") == month]
    revenue = _amount(rows, lambda tx: tx.kind == "revenue" and tx.category != "Pendapatan non-operasional")
    cogs = _amount(rows, lambda tx: tx.kind == "expense" and tx.category == "COGS / HPP")
    opex = _amount(rows, lambda tx: tx.kind == "expense" and tx.category == "OPEX")
    marketing = _amount(rows, lambda tx: tx.kind == "expense" and tx.category == "Marketing")
    non_operating_income = _amount(rows, lambda tx: tx.kind == "revenue" and tx.category == "Pendapatan non-operasional")
    non_operating_expense = _amount(rows, lambda tx: tx.kind == "expense" and tx.category == "Beban non-operasional")
    depreciation = _monthly_depreciation(workspace.assets, month)
    gross_profit = revenue - cogs
    net_profit = gross_profit - opex - marketing - depreciation + non_operating_income - non_operating_expense
    return {
        "rows": [transaction.model_dump(by_alias=True, mode="json") for transaction in rows],
        "revenue": revenue,
        "cogs": cogs,
        "opex": opex,
        "marketing": marketing,
        "nonOperatingIncome": non_operating_income,
        "nonOperatingExpense": non_operating_expense,
        "depreciation": depreciation,
        "netProfit": net_profit,
        "grossMargin": gross_profit / revenue if revenue else None,
        "netMargin": net_profit / revenue if revenue else None,
    }


def build_financial_report(workspace: FinanceWorkspace, month: str) -> dict[str, Any]:
    current = _report_base(workspace, month)
    rows = [transaction for transaction in workspace.transactions if transaction.date.strftime("%Y-%m") == month]
    sum_rows = lambda predicate: _amount(rows, predicate)
    revenue = current["revenue"]
    cogs = current["cogs"]
    opex = current["opex"]
    marketing = current["marketing"]
    non_operating_income = current["nonOperatingIncome"]
    non_operating_expense = current["nonOperatingExpense"]
    depreciation = current["depreciation"]
    gross_profit = revenue - cogs
    operating_profit = gross_profit - opex - marketing - depreciation
    net_profit = operating_profit + non_operating_income - non_operating_expense
    operating_cash_flow = sum(
        transaction.amount if transaction.kind == "revenue" else
        -transaction.amount if transaction.kind == "expense" else 0
        for transaction in rows
    )
    investing_cash_flow = -sum_rows(lambda tx: tx.kind == "asset")
    financing_cash_flow = (
        sum_rows(lambda tx: tx.kind in {"capital", "loan"})
        - sum_rows(lambda tx: tx.kind in {"draw", "principal"})
    )
    change_cash = operating_cash_flow + investing_cash_flow + financing_cash_flow
    end_date = _month_end(month)
    all_through = [
        transaction
        for transaction in workspace.transactions
        if workspace.opening.date < transaction.date <= end_date
    ]
    cash = workspace.opening.cash + sum(_account_delta(transaction, "cash") for transaction in all_through)
    bank = workspace.opening.bank + sum(_account_delta(transaction, "bank") for transaction in all_through)
    bought_assets = _amount(all_through, lambda tx: tx.kind == "asset")
    first_depreciation_month = _month_number(workspace.opening.date.strftime("%Y-%m")) + 1
    report_month_number = _month_number(month)
    accumulated_depreciation = 0.0
    for asset in workspace.assets:
        if asset.residual > asset.cost:
            raise ValueError(f"Nilai residu aset {asset.name} tidak boleh melebihi biaya perolehan.")
        started_month = _month_number(asset.start_date.strftime("%Y-%m"))
        first_month = max(first_depreciation_month, started_month)
        last_month = min(report_month_number, started_month + asset.life_months - 1)
        depreciation_months = max(0, last_month - first_month + 1)
        accumulated_depreciation += depreciation_months * (asset.cost - asset.residual) / asset.life_months
    fixed_assets = workspace.opening.fixed_assets + bought_assets - accumulated_depreciation
    liabilities = (
        workspace.opening.liabilities
        + _amount(all_through, lambda tx: tx.kind == "loan")
        - _amount(all_through, lambda tx: tx.kind == "principal")
    )
    retained = (
        _amount(all_through, lambda tx: tx.kind == "revenue")
        - _amount(all_through, lambda tx: tx.kind == "expense")
        - accumulated_depreciation
    )
    owner_draw = _amount(all_through, lambda tx: tx.kind == "draw")
    equity = (
        workspace.opening.equity
        + _amount(all_through, lambda tx: tx.kind == "capital")
        + retained
        - owner_draw
    )
    previous_month = _month_string(report_month_number - 1)
    previous_rows = [
        transaction
        for transaction in workspace.transactions
        if transaction.date.strftime("%Y-%m") == previous_month
    ]
    previous = _report_base(workspace, previous_month) if previous_rows else None
    report = {
        "month": month,
        "rows": current["rows"],
        "revenue": revenue,
        "cogs": cogs,
        "opex": opex,
        "marketing": marketing,
        "nonOperatingIncome": non_operating_income,
        "nonOperatingExpense": non_operating_expense,
        "depreciation": depreciation,
        "grossProfit": gross_profit,
        "operatingProfit": operating_profit,
        "netProfit": net_profit,
        "operatingCashFlow": operating_cash_flow,
        "investingCashFlow": investing_cash_flow,
        "financingCashFlow": financing_cash_flow,
        "changeCash": change_cash,
        "cash": cash,
        "bank": bank,
        "fixedAssets": fixed_assets,
        "liabilities": liabilities,
        "equity": equity,
        "assetsTotal": cash + bank + fixed_assets,
        "balanceDifference": cash + bank + fixed_assets - liabilities - equity,
        "grossMargin": current["grossMargin"],
        "cogsRatio": cogs / revenue if revenue else None,
        "netMargin": current["netMargin"],
        "previous": previous,
        "cashOpening": cash + bank - change_cash,
        "cashClosing": cash + bank,
    }
    trend = []
    for offset in range(5, -1, -1):
        trend_month = _month_string(report_month_number - offset)
        trend_report = _report_base(workspace, trend_month)
        trend.append({
            "month": trend_month,
            "revenue": trend_report["revenue"],
            "cogs": trend_report["cogs"],
            "netProfit": trend_report["netProfit"],
        })
    return {"report": report, "trend": trend}
