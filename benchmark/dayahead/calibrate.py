"""Out-of-sample forecast errors from the training period, used to size a planning margin.

    python -m benchmark.dayahead.calibrate

Each method is refit on the training period minus its last 90 days and forecasts those 90 days,
exactly as in task B. The test period is never touched, so a margin taken from these errors is
chosen without looking at the backtest.
"""
import os

for var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ.setdefault(var, "1")

import pandas as pd
import torch
from sklearn.preprocessing import StandardScaler

from benchmark.config import BASE_DIR
from benchmark.dayahead.features import FEATURES, TEST_START_DAY, build_features, load_series, split
from benchmark.dayahead.train import LEARNED, NAIVE, SEEDS, seed_everything

CALIBRATION_DAYS = 90
CALIBRATION = os.path.join(BASE_DIR, "predictions", "dayahead_calibration.parquet")


def main():
    torch.set_num_threads(1)
    train, _, _ = split(build_features(load_series()))
    cal_start = TEST_START_DAY - pd.Timedelta(days=CALIBRATION_DAYS)
    fit_all, cal = train[train.index < cal_start], train[train.index >= cal_start]
    n_val = int(round(len(fit_all) * 0.1))
    fit, val = fit_all.iloc[:-n_val], fit_all.iloc[-n_val:]
    scaler = StandardScaler().fit(fit[FEATURES])
    X_fit, X_val, X_all, X_cal = (scaler.transform(p[FEATURES]) for p in (fit, val, fit_all, cal))
    print(f"fit on {len(fit_all)} rows before {cal_start.date()}; calibrate on {len(cal)} rows ({cal_start.date()} -> {cal.index.max()})")

    out = pd.DataFrame({"actual": cal["load"]}, index=cal.index)
    for name, col in NAIVE.items():
        out[name] = cal[col]
    for name, build in LEARNED.items():
        for seed in SEEDS if name != "linear" else SEEDS[:1]:
            seed_everything(seed)
            model = build(seed, len(FEATURES))
            if name == "mlp":
                model.train(X_fit, fit["load"].to_numpy(), X_val, val["load"].to_numpy(), epochs=200, batch_size=32)
            else:
                model.train(X_all, fit_all["load"].to_numpy())
            out[f"{name}_s{seed}"] = model.predict(X_cal)

    out.rename_axis("timestamp").reset_index().to_parquet(CALIBRATION, index=False)
    residual = out.drop(columns="actual").rsub(out["actual"], axis=0)
    print("Under-forecast (actual - forecast) quantiles, kW:")
    print(residual.quantile([0.5, 0.7, 0.9, 0.95]).T.round(1).to_string())
    print(f"Saved {CALIBRATION}")


if __name__ == "__main__":
    main()
