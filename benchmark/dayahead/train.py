"""Task B: forecast all 96 slots of each test day using data up to 23:45 the day before.

    python -m benchmark.dayahead.train

Writes predictions/dayahead_predictions.parquet (one column per method, seed 42) and
results/dayahead_results.csv (one row per method and seed).
"""
import os

# Single-threaded numeric libraries, as in benchmark.run; must be set before numpy/torch load
for var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ.setdefault(var, "1")

import random
import time

import numpy as np
import pandas as pd
import torch
from sklearn.preprocessing import StandardScaler

from benchmark.config import BASE_DIR, PATH
from benchmark.dayahead.features import FEATURES, SLOTS_PER_DAY, build_features, fill_missing_lags, load_series, split
from benchmark.models.fully_connected_MLP import MLPModel
from benchmark.models.linear_regression import LinearModel
from benchmark.models.random_forest import RFModel
from benchmark.training.trainer import PeakRSSMonitor

SEEDS = [42, 123, 999]
PREDICTIONS = os.path.join(BASE_DIR, "predictions", "dayahead_predictions.parquet")
RESULTS = os.path.join(BASE_DIR, PATH["results_folder"], "dayahead_results.csv")

# Learned models use the configuration that did best at 100,000 rows in task A
LEARNED = {
    "linear": lambda seed, n_features: LinearModel(reg_type="none"),
    "mlp": lambda seed, n_features: MLPModel(input_dim=n_features, hidden_layers=[128, 64], dropout=0.0, lr=1e-3),
    "rf": lambda seed, n_features: RFModel(n_estimators=100, max_depth=10, random_seed=seed),
}
NAIVE = {"naive_yesterday": "lag_96", "naive_last_week": "lag_672"}


def seed_everything(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def accuracy(test, pred):
    """Interval errors plus daily peak errors (the peak drives the demand charge)."""
    actual = test["load"].to_numpy()
    err = pred - actual
    days = pd.DataFrame({"day": test["day"].to_numpy(), "actual": actual, "pred": pred}).groupby("day")
    peak_err = days["pred"].max() - days["actual"].max()
    return {
        "rmse": float(np.sqrt(np.mean(err ** 2))),
        "mae": float(np.mean(np.abs(err))),
        "peak_mae": float(np.mean(np.abs(peak_err))),
        "peak_under_share": float(np.mean(peak_err < 0)),
        "peak_under_mean_kw": float(-peak_err[peak_err < 0].mean()) if (peak_err < 0).any() else 0.0,
    }


def per_day_latency_ms(model, X_test):
    """Median time to forecast one day (96 rows in one call) over the first 30 test days."""
    times = []
    for d in range(30):
        rows = X_test[d * SLOTS_PER_DAY:(d + 1) * SLOTS_PER_DAY]
        start = time.perf_counter()
        model.predict(rows)
        times.append((time.perf_counter() - start) * 1000)
    return float(np.median(times))


def main():
    torch.set_num_threads(1)
    frame = build_features(load_series())
    train, test, skipped = split(frame)
    test, filled = fill_missing_lags(test)
    print(f"train {len(train)} rows; test {test['day'].nunique()} days ({skipped} incomplete days skipped, {filled} slots with a filled lag)")

    # Validation for MLP early stopping: the last 10% of the training period
    n_val = int(round(len(train) * 0.1))
    fit, val = train.iloc[:-n_val], train.iloc[-n_val:]
    scaler = StandardScaler().fit(fit[FEATURES])
    X_fit, X_val, X_all, X_test = (scaler.transform(p[FEATURES]) for p in (fit, val, train, test))
    y_fit, y_val, y_all = fit["load"].to_numpy(), val["load"].to_numpy(), train["load"].to_numpy()

    predictions = pd.DataFrame({"day": test["day"], "actual": test["load"]}, index=test.index)
    rows = []

    for name, col in NAIVE.items():
        pred = test[col].to_numpy()
        predictions[name] = pred
        rows.append({"method": name, "seed": None, "train_time_s": 0.0, "rss_delta_mb": 0.0,
                     "predict_ms_per_day": 0.0, **accuracy(test, pred)})

    for name, build in LEARNED.items():
        for seed in SEEDS if name != "linear" else SEEDS[:1]:
            seed_everything(seed)
            model = build(seed, len(FEATURES))
            with PeakRSSMonitor() as mem:
                start = time.perf_counter()
                if name == "mlp":
                    model.train(X_fit, y_fit, X_val, y_val, epochs=200, batch_size=32)
                else:
                    model.train(X_all, y_all)
                train_time = time.perf_counter() - start
            pred = model.predict(X_test)
            if seed == SEEDS[0]:
                predictions[name] = pred
            row = {"method": name, "seed": seed, "train_time_s": round(train_time, 4),
                   "rss_delta_mb": round(mem.peak_mb - mem.baseline_mb, 2),
                   "predict_ms_per_day": round(per_day_latency_ms(model, X_test), 4), **accuracy(test, pred)}
            rows.append(row)
            print(f"{name:<8} seed {seed}: RMSE {row['rmse']:.1f}  peak MAE {row['peak_mae']:.1f}  train {train_time:.1f}s")

    os.makedirs(os.path.dirname(PREDICTIONS), exist_ok=True)
    predictions.rename_axis("timestamp").reset_index().to_parquet(PREDICTIONS, index=False)
    results = pd.DataFrame(rows)
    results.to_csv(RESULTS, index=False)

    summary = results.groupby("method", sort=False)[["rmse", "mae", "peak_mae", "peak_under_share", "train_time_s", "predict_ms_per_day"]].median()
    print("\nMedian over seeds (kW; peak = daily maximum):")
    print(summary.round(3).to_string())
    print(f"\nSaved {PREDICTIONS} and {RESULTS}")


if __name__ == "__main__":
    main()
