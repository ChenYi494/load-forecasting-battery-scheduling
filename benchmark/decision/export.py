"""Export the day-ahead and decision results to web/public/decision.json for the results site.

    python -m benchmark.decision.export

Reads only files written by benchmark.dayahead.train, benchmark.dayahead.calibrate,
benchmark.decision.backtest and benchmark.decision.margin; nothing is typed in by hand.
"""
import json
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from benchmark.config import BASE_DIR, PATH
from benchmark.dayahead.calibrate import CALIBRATION
from benchmark.dayahead.features import TEST_START_DAY, load_series
from benchmark.dayahead.train import PREDICTIONS
from benchmark.decision.backtest import BASE_HOURS, SCHEDULES
from benchmark.decision.battery import battery_for_load
from benchmark.decision.flatten import FLAT_SCHEDULES, FLATTEN
from benchmark.decision.tariff import load_tariff
from benchmark.export import git_commit
from benchmark.multiclient.run import OUT_DIR as MULTICLIENT_DIR
from benchmark.multiclient.select import SELECTION

RESULTS_DIR = os.path.join(BASE_DIR, PATH["results_folder"])
OUTPUT_JSON = os.path.join(BASE_DIR, "web", "public", "decision.json")

METHODS = ["naive_yesterday", "naive_last_week", "linear", "mlp", "rf"]
# Forecasts and plans drawn on the day charts (seed 42 for the learned models)
DAY_SERIES = ["naive_yesterday", "linear_s42", "mlp_s42", "rf_s42"]
DAY_PLANS = ["perfect_foresight", "naive_yesterday", "linear_s42", "mlp_s42", "rf_s42"]
# The worst day of each month is picked from this plan
WORST_DAY_PLAN = "mlp_s42"


def method_of(strategy):
    return pd.Series(strategy).str.replace(r"_s\d+$", "", regex=True).to_numpy()


def stat(values):
    v = pd.Series(values).dropna()
    return {"mean": round(float(v.mean()), 4), "min": round(float(v.min()), 4), "max": round(float(v.max()), 4)} if len(v) else None


def build_accuracy():
    df = pd.read_csv(os.path.join(RESULTS_DIR, "dayahead_results.csv"))
    out = []
    for m in METHODS:
        g = df[df["method"] == m]
        out.append({"method": m, "seeds": int(len(g)),
                    **{k: stat(g[k]) for k in ["rmse", "mae", "peak_mae", "peak_under_share", "train_time_s", "predict_ms_per_day"]}})
    return out


def build_backtest():
    res = pd.read_csv(os.path.join(RESULTS_DIR, "decision_results.csv"))
    res["method"] = method_of(res["strategy"])
    base = res[(res["battery_hours"] == BASE_HOURS) & (res["tariff_shift_h"] == 0)].copy()
    nb = base[base["method"] == "no_battery"].iloc[0]
    for k in ["energy", "basic", "excess"]:
        base[f"{k}_delta"] = base[k] - nb[k]

    rows = []
    for m in ["perfect_foresight", *METHODS]:
        g = base[base["method"] == m]
        rows.append({"method": m, "seeds": int(len(g)),
                     **{k: stat(g[k]) for k in ["total", "saving", "saving_pct", "share_of_perfect", "excess",
                                                "energy_delta", "basic_delta", "excess_delta", "months_with_excess",
                                                "max_demand_kw"]}})

    sensitivity = []
    for (hours, shift, m), g in res[res["method"].isin(["perfect_foresight", *METHODS])].groupby(
            ["battery_hours", "tariff_shift_h", "method"], sort=False):
        sensitivity.append({"battery_hours": float(hours), "tariff_shift_h": int(shift), "method": m,
                            "contract_kw": float(g["contract_kw"].iloc[0]), "share_of_perfect": stat(g["share_of_perfect"]),
                            "saving": stat(g["saving"])})

    monthly = pd.read_csv(os.path.join(RESULTS_DIR, "decision_monthly.csv"))
    monthly = monthly[(monthly["battery_hours"] == BASE_HOURS) & (monthly["tariff_shift_h"] == 0)].copy()
    monthly["method"] = method_of(monthly["strategy"])
    month_rows = (monthly[monthly["method"].isin(["no_battery", "perfect_foresight", *METHODS])]
                  .groupby(["month", "method"], sort=False)[["excess", "max_demand_kw", "total"]].mean().round(2)
                  .reset_index().to_dict("records"))

    margin = pd.read_csv(os.path.join(RESULTS_DIR, "decision_margin.csv"))
    plain = base[base["method"].isin(METHODS)].assign(quantile=0.0, margin_kw=0.0)
    margin = pd.concat([plain, margin], ignore_index=True)
    margin["energy_delta"] = margin["energy"] - nb["energy"]
    margin_rows = []
    for (m, q), g in margin.groupby(["method", "quantile"], sort=False):
        margin_rows.append({"method": m, "quantile": float(q), "margin_kw": stat(g["margin_kw"]),
                            "share_of_perfect": stat(g["share_of_perfect"]), "excess": stat(g["excess"]),
                            "energy_delta": stat(g["energy_delta"])})

    flat = pd.read_csv(os.path.join(RESULTS_DIR, "decision_flatten.csv"))
    flat_rows = []
    for m in ["perfect_foresight", *METHODS]:
        g = flat[flat["method"] == m]
        flat_rows.append({"method": m, "seeds": int(len(g)),
                          **{k: stat(g[k]) for k in ["total", "saving", "share_of_plain_perfect", "excess",
                                                     "months_with_excess", "over_contract_slots"]}})
    plain_slots = {m: stat(base.loc[base["method"] == m, "over_contract_slots"]) for m in ["perfect_foresight", *METHODS]}

    return {
        "flatten_weight": FLATTEN,
        "flatten": flat_rows,
        "plain_over_contract_slots": plain_slots,
        "contract_no_battery_kw": float(nb["contract_kw"]),
        "contract_battery_kw": float(base.loc[base["method"] == "perfect_foresight", "contract_kw"].iloc[0]),
        "no_battery_total": round(float(nb["total"]), 2),
        "no_battery_excess": round(float(nb["excess"]), 2),
        "methods": rows,
        "sensitivity": sensitivity,
        "monthly": month_rows,
        "margin": margin_rows,
    }


def charging_overruns(schedules, contract):
    """Over-contract slots of each plan, and how many of them happen while the battery is charging."""
    out = []
    for strategy, p in schedules.groupby("strategy", sort=False):
        over = p["grid"] > contract + 1e-6
        out.append({"strategy": strategy, "over_slots": int(over.sum()),
                    "over_while_charging": int((over & (p["charge"] > 0)).sum())})
    return out


def build_days(tariff, contract, plain, flat):
    """The worst day of each month for the plain MLP plan, with forecasts and both planners' schedules."""
    predictions = pd.read_parquet(PREDICTIONS).set_index("timestamp")
    plans = {"plain": plain.set_index("timestamp"), "flatten": flat.set_index("timestamp")}
    ref = plans["plain"][plans["plain"]["strategy"] == WORST_DAY_PLAN]
    over = ref["grid"] - contract
    worst = over.groupby(over.index.to_period("M")).idxmax()
    days = []
    for month, ts in worst.items():
        idx = pd.date_range(ts.normalize(), periods=96, freq="15min")
        entry = {
            "day": str(ts.date()),
            "month": str(month),
            "worst_over_kw": round(float(over.loc[ts]), 1),
            "worst_at": ts.strftime("%H:%M"),
            "worst_period": str(tariff.period(pd.DatetimeIndex([ts]))[0]),
            "period": list(tariff.period(idx)),
            "price": [float(p) for p in tariff.energy_price(idx)],
            "actual": [round(float(v), 1) for v in predictions.loc[idx, "actual"]],
            "forecasts": {k: [round(float(v), 1) for v in predictions.loc[idx, k]] for k in DAY_SERIES},
            "plans": {},
        }
        for planner, frame in plans.items():
            for s in DAY_PLANS:
                p = frame[frame["strategy"] == s].loc[idx]
                entry["plans"][f"{s}|{planner}"] = {"grid": [round(float(v), 1) for v in p["grid"]],
                                                    "charge": [round(float(v), 1) for v in p["charge"]],
                                                    "discharge": [round(float(v), 1) for v in p["discharge"]]}
        days.append(entry)
    return days


def build_multiclient():
    """The ten-client check (benchmark.multiclient); None until it has been run."""
    summary_path = os.path.join(MULTICLIENT_DIR, "summary.csv")
    if not os.path.exists(summary_path):
        return None
    with open(SELECTION) as f:
        selection = json.load(f)
    summary = pd.read_csv(summary_path)
    clients = []
    for _, r in summary.iterrows():
        clients.append({
            "client": r["client"], "mean_load_kw": float(r["mean_load_kw"]),
            "contract_no_battery_kw": float(r["contract_no_battery_kw"]), "contract_battery_kw": float(r["contract_battery_kw"]),
            "perfect_saving_pct": round(float(r["perfect_saving_pct"]), 2),
            "best_rmse": r["best_rmse"],
            **{p: {"share": {m: round(float(r[f"{p}_{m}"]), 2) for m in METHODS},
                   "model_gap": round(float(r[f"{p}_model_gap"]), 3), "seed_spread": round(float(r[f"{p}_seed_spread"]), 3),
                   "best": r[f"{p}_best"], "rank_corr_rmse": round(float(r[f"{p}_rank_corr_rmse"]), 3),
                   "rank_corr_peak": round(float(r[f"{p}_rank_corr_peak"]), 3)}
               for p in ("plain", "flatten")},
        })
    learned, naive = ["linear", "mlp", "rf"], ["naive_yesterday", "naive_last_week"]
    best = lambda p, ms: summary[[f"{p}_{m}" for m in ms]].max(axis=1)
    gains = summary["flatten_gain_mean"]
    # Every run, for the interactive dashboard: one row per client, planner and strategy (seeds kept apart)
    runs = []
    for client in summary["client"]:
        b = pd.read_csv(os.path.join(MULTICLIENT_DIR, f"{client}_backtest.csv"))
        for _, r in b.iterrows():
            seed = r["strategy"].rsplit("_s", 1)[-1] if r["strategy"] != r["method"] else None
            runs.append({"client": client, "planner": r["planner"], "method": r["method"],
                         "seed": int(seed) if seed else None, "share": round(float(r["share_of_perfect"]), 3),
                         "saving": round(float(r["saving"]), 1), "excess": round(float(r["excess"]), 1),
                         "total": round(float(r["total"]), 1), "months_with_excess": int(r["months_with_excess"])})
    accuracy = []
    for client in summary["client"]:
        a = pd.read_csv(os.path.join(MULTICLIENT_DIR, f"{client}_accuracy.csv"))
        for _, r in a.iterrows():
            accuracy.append({"client": client, "method": r["method"], "seed": None if pd.isna(r["seed"]) else int(r["seed"]),
                             "rmse": round(float(r["rmse"]), 3), "peak_mae": round(float(r["peak_mae"]), 3)})
    return {
        "rule": selection["rule"], "clients_total": selection["clients_total"], "eligible": selection["eligible"],
        "clients": clients,
        "runs": runs,
        "accuracy": accuracy,
        "summary": {
            "flatten_helps_all_methods": int((summary[[f"flatten_{m}" for m in METHODS]].to_numpy()
                                              > summary[[f"plain_{m}" for m in METHODS]].to_numpy()).all(axis=1).sum()),
            "flatten_gain_mean": round(float(gains.mean()), 2), "flatten_gain_min": round(float(gains.min()), 2),
            "flatten_gain_max": round(float(gains.max()), 2),
            **{f"{p}_{k}": v for p in ("plain", "flatten") for k, v in {
                "gap_above_seed_spread": int((summary[f"{p}_model_gap"] > summary[f"{p}_seed_spread"]).sum()),
                # 3 decimals: rounding to 2 here and to 1 on the site turned 3.745 into 3.8
                "median_model_gap": round(float(summary[f"{p}_model_gap"].median()), 3),
                "median_rank_corr_rmse": round(float(summary[f"{p}_rank_corr_rmse"].median()), 3),
                "median_rank_corr_peak": round(float(summary[f"{p}_rank_corr_peak"].median()), 3),
                "learned_beats_naive": int((best(p, learned) > best(p, naive)).sum()),
                "mean_share": {m: round(float(summary[f"{p}_{m}"].mean()), 2) for m in METHODS},
            }.items()},
        },
    }


def tariff_meta(tariff):
    def spans(season, day_type):
        return [f"{lo // 60:02d}:{lo % 60:02d}–{hi // 60:02d}:{hi % 60:02d} {name}" for lo, hi, name in tariff.periods[season][day_type]]
    return {
        "name": tariff.name,
        "currency": "TWD",
        "source": tariff.source,
        "summer": f"{tariff.summer_start[0]:02d}-{tariff.summer_start[1]:02d} to {tariff.summer_end[0]:02d}-{tariff.summer_end[1]:02d}",
        "basic_per_kw_month": tariff.basic,
        "off_peak_contract_per_kw_month": tariff.off_peak_basic,
        "energy_per_kwh": tariff.energy,
        "periods": {s: {d: spans(s, d) for d in ("weekday", "saturday", "sunday")} for s in ("summer", "non_summer")},
        "excess_multiples": [tariff.penalty_within, tariff.penalty_beyond],
    }


def main():
    tariff = load_tariff()
    series = load_series()
    predictions = pd.read_parquet(PREDICTIONS)
    calibration = pd.read_parquet(CALIBRATION)
    battery = battery_for_load(float(series[series.index < TEST_START_DAY].mean()), BASE_HOURS)
    backtest = build_backtest()
    plain, flat = pd.read_parquet(SCHEDULES), pd.read_parquet(FLAT_SCHEDULES)

    output = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "git_commit": git_commit(),
            "test_start": str(predictions["timestamp"].min()),
            "test_end": str(predictions["timestamp"].max()),
            "test_days": int(predictions["day"].nunique()),
            "calibration_start": str(calibration["timestamp"].min()),
            "calibration_end": str(calibration["timestamp"].max()),
            "battery": {"hours": BASE_HOURS, "capacity_kwh": round(battery.capacity_kwh, 1), "power_kw": round(battery.power_kw, 1),
                        "round_trip_efficiency": battery.round_trip_efficiency},
            "tariff": tariff_meta(tariff),
            "worst_day_plan": WORST_DAY_PLAN,
        },
        "accuracy": build_accuracy(),
        "backtest": backtest,
        "overruns": {"plain": charging_overruns(plain, backtest["contract_battery_kw"]),
                     "flatten": charging_overruns(flat, backtest["contract_battery_kw"])},
        "days": build_days(tariff, backtest["contract_battery_kw"], plain, flat),
        "multiclient": build_multiclient(),
    }
    with open(OUTPUT_JSON, "w") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Saved {OUTPUT_JSON} ({os.path.getsize(OUTPUT_JSON) / 1024:.0f} KB); {len(output['days'])} days")
    for d in output["days"]:
        print(f"  {d['day']}: {WORST_DAY_PLAN} plan {d['worst_over_kw']:+.1f} kW over contract at {d['worst_at']}")


if __name__ == "__main__":
    main()
