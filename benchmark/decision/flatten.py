"""Re-run the base-case backtest with the DP's load-flattening tie-breaker.

    python -m benchmark.decision.flatten

Every slot of the summer peak block (09:00-24:00) has the same price. When the forecast stays under
the contract the plain plan sees nothing to shave, so it may empty the battery in the morning and
have nothing left for the real afternoon peak. With a tiny grid_kw**2 term the plan discharges at
the highest forecast load, which is usually where the real peak is. Same contract, battery and
forecasts as benchmark.decision.backtest; the share is against the same perfect-foresight saving.
"""
import os
import time

import pandas as pd

from benchmark.dayahead.features import TEST_START_DAY, load_series
from benchmark.dayahead.train import NAIVE, PREDICTIONS
from benchmark.decision.backtest import BASE_HOURS, RESULTS_DIR, SCHEDULES, evaluate
from benchmark.decision.battery import battery_for_load
from benchmark.decision.tariff import load_tariff

FLATTEN = 1e-4
FLAT_SCHEDULES = SCHEDULES.replace(".parquet", "_flatten.parquet")


def main():
    start = time.perf_counter()
    tariff = load_tariff()
    series = load_series()
    predictions = pd.read_parquet(PREDICTIONS).set_index("timestamp")
    test_days = sorted(predictions["day"].unique())
    battery = battery_for_load(float(series[series.index < TEST_START_DAY].mean()), BASE_HOURS)

    base = pd.read_csv(os.path.join(RESULTS_DIR, "decision_results.csv"))
    base = base[(base["battery_hours"] == BASE_HOURS) & (base["tariff_shift_h"] == 0)].set_index("strategy")
    contract_nb, contract_b = base.loc["no_battery", "contract_kw"], base.loc["perfect_foresight", "contract_kw"]
    plain_perfect = base.loc["no_battery", "total"] - base.loc["perfect_foresight", "total"]

    names = list(NAIVE) + [c for c in predictions.columns if "_s" in c and c.split("_s")[-1].isdigit()]
    table, _, runs = evaluate(test_days, series, {n: predictions[n] for n in names}, tariff, battery,
                              contract_nb, contract_b, flatten=FLATTEN)
    table["share_of_plain_perfect"] = 100 * table["saving"] / plain_perfect
    table["method"] = table["strategy"].str.replace(r"_s\d+$", "", regex=True)
    table.round(2).to_csv(os.path.join(RESULTS_DIR, "decision_flatten.csv"), index=False)
    pd.concat([run.assign(strategy=n, actual=series.loc[run.index].to_numpy()) for n, (run, _, _) in runs.items()]
              ).rename_axis("timestamp").reset_index().to_parquet(FLAT_SCHEDULES, index=False)

    plain = base.reset_index()
    plain["method"] = plain["strategy"].str.replace(r"_s\d+$", "", regex=True)
    cols = ["share_of_perfect", "excess", "months_with_excess", "over_contract_slots"]
    both = pd.concat({"plain": plain.groupby("method", sort=False)[cols].mean(),
                      "flatten": table.groupby("method", sort=False)[cols + ["share_of_plain_perfect"]].mean()}, axis=1)
    print(f"contract {contract_b:.0f} kW; flatten weight {FLATTEN}")
    print(both.round(1).to_string())
    print("\nSeed spread with flattening (share of plain perfect-foresight saving, %):")
    print(table.groupby("method", sort=False)["share_of_plain_perfect"].agg(["min", "max"]).round(1).to_string())
    print(f"\nSaved results/decision_flatten.csv and {FLAT_SCHEDULES} ({time.perf_counter() - start:.0f} s)")


if __name__ == "__main__":
    main()
