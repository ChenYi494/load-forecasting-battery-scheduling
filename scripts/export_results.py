"""Export benchmark results to web/public/results.json, the only data source of the results site.

Everything the site shows is computed here from results/summary_results.csv, the March backup
and the dataset; nothing is typed in by hand.
"""
import ast
import json
import os
import random
import subprocess
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import torch

from config.params import BASE_DIR, COMMON_BASE, PATH
from data.dataset import load_dataset
from experiments.run_experiment import get_model
from training.trainer import BATCH_ROUNDS, LATENCY_ROUNDS, LATENCY_SAMPLES

RESULTS_CSV = os.path.join(BASE_DIR, PATH["results_folder"], PATH["summary_results"])
MARCH_CSV = os.path.join(BASE_DIR, PATH["results_folder"], "before", "summary_results_2026-03.csv")
OUTPUT_JSON = os.path.join(BASE_DIR, "web", "public", "results.json")

METRICS = ["rmse", "mae", "train_time_s", "rss_delta_mb", "model_size_mb", "latency_ms_median", "latency_ms_p95"]
MODEL_ORDER = ["naive", "linear", "mlp", "rf"]

# Representative configurations (seed 42) re-trained to draw the forecast week
FORECAST_MODELS = [
    {"key": "linear_100k", "label": "Linear regression (100k rows)", "prefix": "linear_ds100000_s42_none_na"},
    {"key": "mlp_100k", "label": "MLP 128×64 (100k rows)", "prefix": "mlp_ds100000_s42_128x64_d0.0_b32"},
    {"key": "rf_10k", "label": "Random forest (10k rows)", "prefix": "rf_ds10000_s42_n100_dunlimit"},
    {"key": "rf_100k", "label": "Random forest (100k rows)", "prefix": "rf_ds100000_s42_n100_dunlimit"},
]


def parse_params(text):
    try:
        return ast.literal_eval(text) if isinstance(text, str) else {}
    except (ValueError, SyntaxError):
        return {}


def variant_label(model, params, exp_name):
    if model == "naive":
        return {"lag_1": "15 min earlier (persistence)", "lag_96": "24 h earlier"}[params["lag_col"]]
    if model == "linear":
        # LinearRegression has no alpha; Ridge does
        return f"Ridge α={params['alpha']}" if "alpha" in params else "OLS"
    if model == "mlp":
        layers = "×".join(str(h) for h in params["hidden_layers"])
        # Batch size is not stored in the hyperparameters; the run name carries it (..._b32_...)
        batch = exp_name.split("_b")[-1].split("_")[0]
        return f"{layers}, dropout {params['dropout']}, batch {batch}"
    if model == "rf":
        depth = params["max_depth"] if params["max_depth"] is not None else "∞"
        return f"{params['n_estimators']} trees, depth {depth}"
    return ""


def round_or_none(value, digits):
    return None if value is None or pd.isna(value) else round(float(value), digits)


def git_commit():
    try:
        return subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=BASE_DIR,
                              capture_output=True, text=True, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def build_groups(df):
    groups = []
    for (model, size), part in df.groupby(["model", "dataset_size"]):
        entry = {"model": model, "dataset_size": int(size), "runs": int(len(part))}
        for m in METRICS:
            entry[m] = {"median": round_or_none(part[m].median(), 4),
                        "min": round_or_none(part[m].min(), 4),
                        "max": round_or_none(part[m].max(), 4)}
        groups.append(entry)
    groups.sort(key=lambda g: (MODEL_ORDER.index(g["model"]), g["dataset_size"]))
    return groups


def build_runs(df):
    runs = []
    for _, row in df.iterrows():
        runs.append({
            "exp_name": row["exp_name"],
            "model": row["model"],
            "dataset_size": int(row["dataset_size"]),
            "seed": int(row["seed"]),
            "variant": row["variant"],
            "effective_epochs": int(row["effective_epochs"]),
            **{m: round_or_none(row[m], 4) for m in METRICS},
        })
    return runs


def build_before(march):
    before = []
    for (model, size), part in march.groupby(["model", "dataset_size"]):
        before.append({"model": model, "dataset_size": int(size), "runs": int(len(part)),
                       "rmse_median": round_or_none(part["rmse"].median(), 4),
                       "mae_median": round_or_none(part["mae"].median(), 4)})
    return before


def find_config(prefix):
    model = prefix.split("_")[0]
    with open(os.path.join(BASE_DIR, PATH["exp_config_folder"], f"{model}.json")) as f:
        matches = [c for c in json.load(f) if c["exp_name"].startswith(prefix)]
    if len(matches) != 1:
        raise ValueError(f"Expected one config for {prefix}, found {len(matches)}")
    return matches[0]


def retrain_and_predict(cfg):
    """Re-trains one configuration exactly as run_experiment does and returns test predictions."""
    seed = cfg["random_seed"]
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    X_train, X_val, X_test, y_train, y_val, y_test, spans = load_dataset(
        cfg["dataset_path"], cfg["target_col"], 1 - cfg["train_ratio"], cfg["dataset_size"], cfg["shuffle"])
    model = get_model(cfg, X_train, spans)
    if cfg["model"] == "mlp":
        model.train(X_train, y_train, X_val, y_val, epochs=cfg["epochs"], batch_size=cfg["batch_size"])
        train_max = float(max(y_train.max(), y_val.max()))
    else:
        X_all, y_all = np.r_[X_train, X_val], np.r_[y_train, y_val]
        model.train(X_all, y_all)
        train_max = float(y_all.max())
    return model.predict(X_test), y_test, train_max


def build_forecast_and_findings(df, groups):
    data = pd.read_parquet(os.path.join(BASE_DIR, COMMON_BASE["dataset_path"]))
    n_test = int(round(len(data) * (1 - COMMON_BASE["train_ratio"])))
    test = data.iloc[-n_test:].reset_index(drop=True)

    # Forecast week: the 7 days starting at midnight before the highest test load (summer peak)
    peak_ts = test.loc[test["load"].idxmax(), "timestamp"]
    start = peak_ts.normalize() - pd.Timedelta(days=3)
    week = (test["timestamp"] >= start) & (test["timestamp"] < start + pd.Timedelta(days=7))

    series = {"persistence": test.loc[week, "lag_1"].round(2).tolist()}
    extrapolation = []
    for fm in FORECAST_MODELS:
        cfg = find_config(fm["prefix"])
        print(f"Re-training {cfg['exp_name']} for the forecast week ...", flush=True)
        pred, y_test, train_max = retrain_and_predict(cfg)
        series[fm["key"]] = np.round(pred[week.values], 2).tolist()
        above = y_test > train_max
        extrapolation.append({
            "key": fm["key"], "label": fm["label"], "train_max_kw": round(train_max, 1),
            "share_test_above_train_max": round(float(above.mean()), 4),
            "rmse_rows_above": round_or_none(np.sqrt(np.mean((y_test[above] - pred[above]) ** 2)) if above.any() else None, 2),
            "rmse_rows_within": round_or_none(np.sqrt(np.mean((y_test[~above] - pred[~above]) ** 2)), 2),
        })

    forecast_week = {
        "start": str(start), "end": str(start + pd.Timedelta(days=7)),
        "timestamps": test.loc[week, "timestamp"].dt.strftime("%Y-%m-%d %H:%M").tolist(),
        "actual": test.loc[week, "load"].round(2).tolist(),
        "series": series,
        "labels": {"persistence": "15 min earlier (persistence)", **{fm["key"]: fm["label"] for fm in FORECAST_MODELS}},
    }

    persistence = float(df[(df["model"] == "naive") & (df["variant"].str.startswith("15 min"))]["rmse"].iloc[0])
    best = df[df["model"] != "naive"].sort_values("rmse").iloc[0]
    best_by_size = []
    for size, part in df[df["model"] != "naive"].groupby("dataset_size"):
        b = part.sort_values("rmse").iloc[0]
        best_by_size.append({"dataset_size": int(size), "exp_name": b["exp_name"], "model": b["model"],
                             "rmse": round(float(b["rmse"]), 4),
                             "vs_persistence_pct": round((float(b["rmse"]) - persistence) / persistence * 100, 2)})
    medians = {(g["model"], g["dataset_size"]): g for g in groups}
    findings = {
        "best_run": {"exp_name": best["exp_name"], "model": best["model"], "dataset_size": int(best["dataset_size"]),
                     "rmse": round(float(best["rmse"]), 4),
                     "vs_persistence_pct": round((float(best["rmse"]) - persistence) / persistence * 100, 2)},
        "best_by_size": best_by_size,
        "rf_memory_100k_vs_linear_mb": [medians[("rf", 100000)]["rss_delta_mb"]["median"],
                                        medians[("linear", 100000)]["rss_delta_mb"]["median"]],
        "extrapolation": extrapolation,
    }
    return forecast_week, findings, test


def main():
    df = pd.read_csv(RESULTS_CSV)
    df["params"] = df["hyperparameters"].apply(parse_params)
    df["variant"] = [variant_label(m, p, e) for m, p, e in zip(df["model"], df["params"], df["exp_name"])]
    march = pd.read_csv(MARCH_CSV)

    groups = build_groups(df)
    naive = df[df["model"] == "naive"].drop_duplicates("variant")
    baselines = [{"variant": r["variant"], "lag_col": r["params"]["lag_col"],
                  "rmse": round(float(r["rmse"]), 4), "mae": round(float(r["mae"]), 4)} for _, r in naive.iterrows()]
    forecast_week, findings, test = build_forecast_and_findings(df, groups)
    data_rows = len(pd.read_parquet(os.path.join(BASE_DIR, COMMON_BASE["dataset_path"])))

    first = df.iloc[0]
    output = {
        "meta": {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "git_commit": git_commit(),
            "dataset": "UCI ElectricityLoadDiagrams20112014",
            "dataset_url": "https://archive.ics.uci.edu/dataset/321/electricityloaddiagrams20112014",
            "client": "MT_200",
            "unit": "kW",
            "interval_minutes": 15,
            "rows": data_rows,
            "target": "load in the next 15-minute interval",
            "features": ["hour", "minute", "day_of_week", "is_weekend", "lag_1", "lag_96"],
            "test_start": first["test_start"], "test_end": first["test_end"], "test_rows": int(first["test_size"]),
            "dataset_sizes": sorted(int(s) for s in df["dataset_size"].unique()),
            "runs": int(len(df)),
            "hardware": json.loads(first["hardware_profile"]),
            "protocol": {
                "latency": f"{LATENCY_SAMPLES} test rows predicted one at a time, {LATENCY_ROUNDS} rounds after a warm-up; median and p95",
                "batch": f"whole test set predicted {BATCH_ROUNDS} times; median",
                "memory": "increase of process RSS during training, sampled every 10 ms, each run in a fresh process",
                "threads": "single-threaded (PyTorch, BLAS, scikit-learn)",
            },
        },
        "baselines": baselines,
        "groups": groups,
        "runs": build_runs(df),
        "before": build_before(march),
        "forecast_week": forecast_week,
        "findings": findings,
    }

    os.makedirs(os.path.dirname(OUTPUT_JSON), exist_ok=True)
    with open(OUTPUT_JSON, "w") as f:
        json.dump(output, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Saved {OUTPUT_JSON} ({os.path.getsize(OUTPUT_JSON) / 1024:.0f} KB)")
    print(f"runs={len(output['runs'])} groups={len(groups)} before={len(output['before'])} "
          f"forecast points={len(forecast_week['timestamps'])} ({forecast_week['start']} to {forecast_week['end']})")
    print("Best run:", findings["best_run"])
    for e in findings["extrapolation"]:
        print("Extrapolation:", e)


if __name__ == "__main__":
    main()
