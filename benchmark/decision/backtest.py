"""Daily battery backtest: plan each test day from a forecast, then bill the plan against the actual load.

    python -m benchmark.decision.backtest

Each strategy plans tomorrow's battery schedule with the DP from a day-ahead forecast (or from the
actual load, for the perfect-foresight upper bound). The plan is then run against the actual load:
the battery follows the planned charge and discharge, and any load the forecast missed is drawn
from the grid. Bills use the Taipower high-voltage two-stage tariff (configs/tariff.yaml).

The contracted capacity is a yearly decision made before the test period, from the last 12 months
of training data: without a battery, the contract that minimizes that year's bill; with a battery,
the contract that minimizes it if the battery were planned with perfect foresight.
"""
import dataclasses
import os
import time

import numpy as np
import pandas as pd

from benchmark.config import BASE_DIR, PATH
from benchmark.dayahead.features import SLOTS_PER_DAY, TEST_START_DAY, load_series
from benchmark.dayahead.train import NAIVE, PREDICTIONS
from benchmark.decision.battery import battery_for_load
from benchmark.decision.dp import schedule_day
from benchmark.decision.lp_check import solve_day_lp
from benchmark.decision.settle import actual_grid, monthly_bill
from benchmark.decision.tariff import load_tariff

BATTERY_HOURS = [1.0, 2.0, 4.0]
BASE_HOURS = 2.0
SHIFTS_H = [-2, 0, 2]                    # move the tariff's period windows earlier / later
CONTRACT_STEP_KW = 10.0
COARSE_STEP_KW = 50.0
SEARCH_POWER_STEPS = 10                  # coarser DP while searching the contract (gap to LP under 0.25%)
POWER_STEPS = 20                         # DP resolution for the backtest itself (gap to LP under 0.15%)
# Weight on each kW above the contract while planning a single day: the 3x excess rate.
# The real charge is on the monthly maximum, so this makes the planner avoid any overrun.
OVERLOAD_MULTIPLE = 3.0

RESULTS_DIR = os.path.join(BASE_DIR, PATH["results_folder"])
SCHEDULES = os.path.join(BASE_DIR, "predictions", "decision_schedules.parquet")


def complete_days(series):
    counts = series.groupby(series.index.normalize()).count()
    return list(counts[counts == SLOTS_PER_DAY].index)


def run_days(days, series, plan_source, contract, battery, tariff, power_steps=POWER_STEPS):
    """Plan every day from plan_source (None = no battery) and settle against the actual series."""
    grid, charge, discharge, soc = [], [], [], []
    for day in days:
        ts = pd.date_range(day, periods=SLOTS_PER_DAY, freq="15min")
        actual = series.loc[ts].to_numpy()
        if plan_source is None:
            c = d = np.zeros(SLOTS_PER_DAY)
            s = np.full(SLOTS_PER_DAY + 1, 0.0)
        else:
            planned_load = np.clip(plan_source.loc[ts].to_numpy(), 0.0, None)
            plan = schedule_day(planned_load, tariff.energy_price(ts), contract, battery,
                                OVERLOAD_MULTIPLE * tariff.excess_rate(ts), power_steps=power_steps)
            c, d, s = plan.charge_kw, plan.discharge_kw, plan.soc_kwh
        grid.append(actual_grid(actual, c, d))
        charge.append(c)
        discharge.append(d)
        soc.append(s[:-1])
    index = pd.DatetimeIndex(np.concatenate([pd.date_range(d, periods=SLOTS_PER_DAY, freq="15min") for d in days]))
    return pd.DataFrame({"grid": np.concatenate(grid), "charge": np.concatenate(charge),
                         "discharge": np.concatenate(discharge), "soc": np.concatenate(soc)}, index=index)


def bill(run, contract, tariff, battery=None):
    cycle = 0.0 if battery is None else battery.cycle_cost_per_kwh
    return monthly_bill(run.index, run["grid"].to_numpy(), contract, tariff, run["discharge"].to_numpy(), cycle)


def choose_contract(days, series, tariff, battery=None):
    """Contract (multiple of 10 kW) that minimizes the training year's bill: a 50 kW scan, then 10 kW around the best."""
    peak = series.loc[series.index.normalize().isin(days)].max()
    no_battery_run = run_days(days, series, None, 0.0, None, tariff) if battery is None else None

    def total(c):
        run = no_battery_run if battery is None else run_days(days, series, series, c, battery, tariff, SEARCH_POWER_STEPS)
        return bill(run, c, tariff, battery)["total"].sum()

    low = np.floor(0.6 * peak / COARSE_STEP_KW) * COARSE_STEP_KW
    coarse = np.arange(low, peak + COARSE_STEP_KW, COARSE_STEP_KW)
    best = coarse[int(np.argmin([total(c) for c in coarse]))]
    if best in (coarse[0], coarse[-1]):
        raise RuntimeError(f"best contract {best} kW is at the edge of the search range")
    fine = np.arange(best - COARSE_STEP_KW + CONTRACT_STEP_KW, best + COARSE_STEP_KW, CONTRACT_STEP_KW)
    return float(fine[int(np.argmin([total(c) for c in fine]))])


def evaluate(test_days, series, forecasts, tariff, battery, contract_no_battery, contract_battery):
    """Annual bill for every strategy on the test days; forecasts maps strategy name -> forecast series."""
    runs = {"no_battery": (run_days(test_days, series, None, 0.0, None, tariff), contract_no_battery, None),
            "perfect_foresight": (run_days(test_days, series, series, contract_battery, battery, tariff), contract_battery, battery)}
    for name in forecasts:
        runs[name] = (run_days(test_days, series, forecasts[name], contract_battery, battery, tariff), contract_battery, battery)
    rows, monthly = [], []
    for name, (run, contract, bat) in runs.items():
        b = bill(run, contract, tariff, bat)
        b.insert(0, "strategy", name)
        monthly.append(b)
        rows.append({"strategy": name, "contract_kw": contract, "total": b["total"].sum(), "energy": b["energy"].sum(),
                     "basic": b["basic"].sum(), "excess": b["excess"].sum(), "cycling": b["cycling"].sum(),
                     "months_with_excess": int((b["excess"] > 0).sum()), "over_contract_slots": int(b["over_contract_slots"].sum()),
                     "max_demand_kw": float(b["max_demand_kw"].max())})
    table = pd.DataFrame(rows)
    base = table.loc[table["strategy"] == "no_battery", "total"].iloc[0]
    ideal = base - table.loc[table["strategy"] == "perfect_foresight", "total"].iloc[0]
    table["saving"] = base - table["total"]
    table["saving_pct"] = 100 * table["saving"] / base
    table["share_of_perfect"] = 100 * table["saving"] / ideal if ideal > 0 else np.nan
    return table, pd.concat(monthly, ignore_index=True), runs


def lp_check(days, series, tariff, battery, contract):
    """Gap between the DP and the exact LP optimum on real test days with perfect foresight."""
    gaps = []
    for day in days:
        ts = pd.date_range(day, periods=SLOTS_PER_DAY, freq="15min")
        load, price, weight = series.loc[ts].to_numpy(), tariff.energy_price(ts), OVERLOAD_MULTIPLE * tariff.excess_rate(ts)
        dp = schedule_day(load, price, contract, battery, weight, power_steps=POWER_STEPS).cost
        gaps.append(100 * (dp - solve_day_lp(load, price, contract, battery, weight)) / dp)
    return np.array(gaps)


def main():
    start = time.perf_counter()
    tariff = load_tariff()
    series = load_series()
    predictions = pd.read_parquet(PREDICTIONS).set_index("timestamp")
    names = list(NAIVE) + [c for c in predictions.columns if "_s" in c and c.split("_s")[-1].isdigit()]
    forecasts = {name: predictions[name] for name in names}
    test_days = sorted(predictions["day"].unique())
    train_year = [d for d in complete_days(series) if TEST_START_DAY - pd.Timedelta(days=365) <= d < TEST_START_DAY]
    mean_load = float(series[series.index < TEST_START_DAY].mean())
    print(f"tariff: {tariff.name}; test {len(test_days)} days; contract chosen on {len(train_year)} training days; mean load {mean_load:.1f} kW")

    contract_nb = choose_contract(train_year, series, tariff)
    tables, monthly_all = [], []
    for hours in BATTERY_HOURS:
        battery = battery_for_load(mean_load, hours)
        contract_b = choose_contract(train_year, series, tariff, battery)
        shifts = SHIFTS_H if hours == BASE_HOURS else [0]
        for shift in shifts:
            t = dataclasses.replace(tariff, shift=pd.Timedelta(hours=shift))
            if shift != 0:
                c_nb, c_b = choose_contract(train_year, series, t), choose_contract(train_year, series, t, battery)
            else:
                c_nb, c_b = contract_nb, contract_b
            table, monthly, runs = evaluate(test_days, series, forecasts, t, battery, c_nb, c_b)
            table.insert(0, "battery_hours", hours)
            table.insert(1, "tariff_shift_h", shift)
            monthly.insert(0, "battery_hours", hours)
            monthly.insert(1, "tariff_shift_h", shift)
            tables.append(table)
            monthly_all.append(monthly)
            print(f"battery {hours:.0f} h ({battery.capacity_kwh:.0f} kWh, {battery.power_kw:.0f} kW), shift {shift:+d} h: "
                  f"contract {c_nb:.0f} kW without battery, {c_b:.0f} kW with battery")
            if hours == BASE_HOURS and shift == 0:
                base_runs, base_battery, base_contract = runs, battery, c_b

    results = pd.concat(tables, ignore_index=True)
    os.makedirs(RESULTS_DIR, exist_ok=True)
    results.round(2).to_csv(os.path.join(RESULTS_DIR, "decision_results.csv"), index=False)
    pd.concat(monthly_all, ignore_index=True).round(2).to_csv(os.path.join(RESULTS_DIR, "decision_monthly.csv"), index=False)

    schedules = []
    for name, (run, _, _) in base_runs.items():
        schedules.append(run.assign(strategy=name, actual=series.loc[run.index].to_numpy()))
    pd.concat(schedules).rename_axis("timestamp").reset_index().to_parquet(SCHEDULES, index=False)

    gaps = lp_check(test_days[::10], series, tariff, base_battery, base_contract)
    print(f"\nDP vs LP optimum on {len(gaps)} test days: mean gap {gaps.mean():.3f}%, max {gaps.max():.3f}%")

    results["method"] = results["strategy"].str.replace(r"_s\d+$", "", regex=True)
    by_method = (results.groupby(["battery_hours", "tariff_shift_h", "method"], sort=False)
                 .agg(seeds=("strategy", "size"), total_mean=("total", "mean"), excess_mean=("excess", "mean"),
                      saving_mean=("saving", "mean"), share_mean=("share_of_perfect", "mean"),
                      share_min=("share_of_perfect", "min"), share_max=("share_of_perfect", "max"))
                 .reset_index())
    by_method.round(2).to_csv(os.path.join(RESULTS_DIR, "decision_by_method.csv"), index=False)

    base = results[(results["battery_hours"] == BASE_HOURS) & (results["tariff_shift_h"] == 0)]
    cols = ["strategy", "contract_kw", "total", "excess", "months_with_excess", "saving", "saving_pct", "share_of_perfect"]
    print(f"\nBase case ({BASE_HOURS:.0f} h battery), TWD over the test period:")
    print(base[cols].round(1).to_string(index=False))
    print("\nShare of the perfect-foresight saving (%), mean [min, max] over seeds:")
    by_method["cell"] = by_method.apply(lambda r: f"{r.share_mean:.1f} [{r.share_min:.1f}, {r.share_max:.1f}]" if r.seeds > 1 else f"{r.share_mean:.1f}", axis=1)
    print(by_method.pivot_table(index="method", columns=["battery_hours", "tariff_shift_h"], values="cell", aggfunc="first", sort=False).to_string())
    print(f"\nSaved results/decision_results.csv, decision_by_method.csv, decision_monthly.csv, {SCHEDULES} ({time.perf_counter() - start:.0f} s)")


if __name__ == "__main__":
    main()
