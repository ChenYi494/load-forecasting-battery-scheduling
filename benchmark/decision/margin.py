"""Plan the battery from forecast + a safety margin, to see how much of the excess charge it avoids.

    python -m benchmark.decision.margin

The margin for each forecast is a quantile of its under-forecast error (actual - forecast) on the
90 days before the test period (predictions/dayahead_calibration.parquet), so it is fixed before the
backtest. Base case only (2 h battery, unshifted tariff); the contract is the one chosen in
benchmark.decision.backtest.
"""
import os
import time

import pandas as pd

from benchmark.dayahead.calibrate import CALIBRATION
from benchmark.dayahead.features import TEST_START_DAY, load_series
from benchmark.dayahead.train import PREDICTIONS
from benchmark.decision.backtest import BASE_HOURS, RESULTS_DIR, evaluate
from benchmark.decision.battery import battery_for_load
from benchmark.decision.tariff import load_tariff

QUANTILES = [0.5, 0.7, 0.9, 0.95]


def main():
    start = time.perf_counter()
    tariff = load_tariff()
    series = load_series()
    predictions = pd.read_parquet(PREDICTIONS).set_index("timestamp")
    calibration = pd.read_parquet(CALIBRATION).set_index("timestamp")
    test_days = sorted(predictions["day"].unique())
    battery = battery_for_load(float(series[series.index < TEST_START_DAY].mean()), BASE_HOURS)

    base = pd.read_csv(os.path.join(RESULTS_DIR, "decision_results.csv"))
    base = base[(base["battery_hours"] == BASE_HOURS) & (base["tariff_shift_h"] == 0)].set_index("strategy")
    contract_nb, contract_b = base.loc["no_battery", "contract_kw"], base.loc["perfect_foresight", "contract_kw"]

    methods = [c for c in calibration.columns if c != "actual"]
    forecasts, margins = {}, []
    for name in methods:
        residual = calibration["actual"] - calibration[name]
        for q in QUANTILES:
            m = max(0.0, float(residual.quantile(q)))
            forecasts[f"{name}+q{int(q * 100)}"] = predictions[name] + m
            margins.append({"strategy": f"{name}+q{int(q * 100)}", "forecast": name, "quantile": q, "margin_kw": round(m, 1)})

    table, _, _ = evaluate(test_days, series, forecasts, tariff, battery, contract_nb, contract_b)
    table = table.merge(pd.DataFrame(margins), on="strategy", how="left")
    table["method"] = table["forecast"].str.replace(r"_s\d+$", "", regex=True)
    table.round(2).to_csv(os.path.join(RESULTS_DIR, "decision_margin.csv"), index=False)

    # Margin 0 = the plain forecast, from the main backtest
    plain = base.reset_index()
    plain = plain[~plain["strategy"].isin(["no_battery", "perfect_foresight"])].assign(quantile=0.0)
    plain["method"] = plain["strategy"].str.replace(r"_s\d+$", "", regex=True)
    both = pd.concat([plain, table[table["quantile"].notna()]], ignore_index=True)
    summary = both.pivot_table(index="method", columns="quantile", values="share_of_perfect", aggfunc="mean", sort=False)
    excess = both.pivot_table(index="method", columns="quantile", values="excess", aggfunc="mean", sort=False)
    print(f"contract {contract_b:.0f} kW; margins from {len(calibration)} calibration slots")
    print("\nShare of the perfect-foresight saving (%), mean over seeds; column = margin quantile (0 = no margin):")
    print(summary.round(1).to_string())
    print("\nExcess charge (TWD), mean over seeds:")
    print(excess.round(0).to_string())
    print("\nSpread over seeds at each quantile (min-max share, %):")
    print(both.groupby(["method", "quantile"])["share_of_perfect"].agg(["min", "max"]).unstack().round(1).to_string())
    print(f"\nSaved results/decision_margin.csv ({time.perf_counter() - start:.0f} s)")


if __name__ == "__main__":
    main()
