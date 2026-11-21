"""Repeat task B and the base-case backtest on every selected client.

    python -m benchmark.multiclient.run [--workers 4] [--clients MT_068 MT_069]

Same pipeline as the main study (benchmark.dayahead.train, benchmark.decision.backtest), per client:
day-ahead forecasts (naive, linear, MLP and random forest with 3 seeds), a 2 h battery sized from the
client's mean load, the contract chosen on the last training year, then the plain plan and the
discharge-at-highest-load plan. Contract search steps scale with the client's peak (5% coarse, 1% fine).
Each client runs in its own process; results go to results/multiclient/<client>_*.csv.
"""
import os

for var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ.setdefault(var, "1")

import argparse
import json
import multiprocessing as mp
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

import numpy as np
import pandas as pd

from benchmark.config import BASE_DIR
from benchmark.dayahead.features import SLOTS_PER_DAY, TEST_START_DAY, load_series
from benchmark.dayahead.train import train_all
from benchmark.decision.backtest import BASE_HOURS, choose_contract, complete_days, evaluate
from benchmark.decision.battery import battery_for_load
from benchmark.decision.flatten import FLATTEN
from benchmark.decision.tariff import load_tariff
from benchmark.multiclient.select import SELECTION

OUT_DIR = os.path.join(BASE_DIR, "results", "multiclient")


def nice_step(kw):
    """Round a step to 1, 2 or 5 times a power of ten."""
    exp = 10 ** np.floor(np.log10(kw))
    return float(min((m * exp for m in (1, 2, 5, 10)), key=lambda v: abs(v - kw)))


def run_client(client):
    start = time.perf_counter()
    series = load_series(client)
    predictions, rows = train_all(series, verbose=False)
    accuracy = pd.DataFrame(rows).assign(client=client)

    tariff = load_tariff()
    test_days = sorted(predictions["day"].unique())
    train_year = [d for d in complete_days(series) if TEST_START_DAY - pd.Timedelta(days=365) <= d < TEST_START_DAY]
    mean_load = float(series[series.index < TEST_START_DAY].mean())
    peak = float(series[series.index.normalize().isin(train_year)].max())
    fine, coarse = nice_step(0.01 * peak), nice_step(0.05 * peak)
    battery = battery_for_load(mean_load, BASE_HOURS)
    contract_nb = choose_contract(train_year, series, tariff, fine_step=fine, coarse_step=coarse)
    contract_b = choose_contract(train_year, series, tariff, battery, fine_step=fine, coarse_step=coarse)

    names = [c for c in predictions.columns if c not in ("day", "actual")]
    forecasts = {n: predictions[n] for n in names}
    tables = []
    for planner, flatten in (("plain", 0.0), ("flatten", FLATTEN)):
        table, _, _ = evaluate(test_days, series, forecasts, tariff, battery, contract_nb, contract_b, flatten=flatten)
        tables.append(table.assign(planner=planner))
    backtest = pd.concat(tables, ignore_index=True)
    # Both planners are scored against the plain perfect-foresight saving
    plain = backtest[backtest["planner"] == "plain"].set_index("strategy")
    ideal = plain.loc["no_battery", "total"] - plain.loc["perfect_foresight", "total"]
    backtest["share_of_perfect"] = 100 * backtest["saving"] / ideal
    backtest["method"] = backtest["strategy"].str.replace(r"_s\d+$", "", regex=True)
    backtest = backtest.assign(client=client, mean_load_kw=round(mean_load, 1), peak_kw=round(peak, 1),
                               battery_kwh=round(battery.capacity_kwh, 1), battery_kw=round(battery.power_kw, 1),
                               contract_step_kw=fine, train_rows=int(series[series.index < TEST_START_DAY].notna().sum()),
                               test_days=len(test_days))

    accuracy.to_csv(os.path.join(OUT_DIR, f"{client}_accuracy.csv"), index=False)
    backtest.round(4).to_csv(os.path.join(OUT_DIR, f"{client}_backtest.csv"), index=False)
    return client, time.perf_counter() - start, contract_nb, contract_b, float(ideal)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--clients", nargs="*")
    args = parser.parse_args()
    with open(SELECTION) as f:
        clients = args.clients or json.load(f)["clients"]
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"{len(clients)} clients, {args.workers} workers: {clients}", flush=True)
    with ProcessPoolExecutor(max_workers=args.workers, mp_context=mp.get_context("spawn")) as pool:
        futures = {pool.submit(run_client, c): c for c in clients}
        for f in as_completed(futures):
            client, seconds, c_nb, c_b, ideal = f.result()
            print(f"{client}: contract {c_nb:g} -> {c_b:g} kW, perfect-foresight saving {ideal:,.0f} TWD ({seconds / 60:.1f} min)", flush=True)


if __name__ == "__main__":
    main()
