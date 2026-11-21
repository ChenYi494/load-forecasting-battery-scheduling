"""Run a planned schedule against the actual load and bill it."""
import numpy as np
import pandas as pd

from benchmark.decision.tariff import SLOT_HOURS, Tariff


def actual_grid(actual_kw, charge_kw, discharge_kw):
    """The battery follows the plan; draw cannot go below zero (no export is paid)."""
    return np.maximum(np.asarray(actual_kw) + charge_kw - discharge_kw, 0.0)


def monthly_bill(ts: pd.DatetimeIndex, grid_kw, contract_kw, tariff: Tariff, discharge_kw=None, cycle_cost=0.0):
    """Bill per calendar month: energy + basic charge (prorated by days of each season) + excess charge.

    Demand is the 15-minute average draw, matching the 15-minute demand meter.
    """
    frame = pd.DataFrame({
        "grid": grid_kw,
        "price": tariff.energy_price(ts),
        "season": tariff.season(ts),
        "period": tariff.period(ts),
        "discharge": 0.0 if discharge_kw is None else discharge_kw,
    }, index=ts)
    frame["month"] = ts.to_period("M")
    frame["day"] = ts.normalize()
    rows = []
    for month, m in frame.groupby("month"):
        days = m.groupby("day")["season"].first()
        basic = sum(tariff.basic[s] * contract_kw * (n / month.days_in_month) for s, n in days.value_counts().items())
        max_by_period = m.groupby("period")["grid"].max().to_dict()
        season = days.value_counts().idxmax()
        rows.append({
            "month": str(month),
            "days": len(days),
            "energy": float((m["grid"] * m["price"]).sum() * SLOT_HOURS),
            "basic": float(basic),
            "excess": float(tariff.excess_charge(max_by_period, contract_kw, season)),
            "cycling": float(m["discharge"].sum() * SLOT_HOURS * cycle_cost),
            "peak_demand_kw": float(max_by_period.get("peak", 0.0)),
            "max_demand_kw": float(m["grid"].max()),
            "over_contract_slots": int((m["grid"] > contract_kw + 1e-6).sum()),
        })
    bill = pd.DataFrame(rows)
    bill["total"] = bill[["energy", "basic", "excess", "cycling"]].sum(axis=1)
    return bill
