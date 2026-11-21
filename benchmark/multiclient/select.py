"""Pick the clients for the multi-client check with a fixed rule, and save their load series.

    python -m benchmark.multiclient.select

Rule: data on at least 99% of days from 2012-01-01 to 2014-12-31 (no late start or early end) and
mean load of at least 100 kW in that window (Taipower's high-voltage tariff needs a contract of at
least 100 kW). MT_200, the client of the main study, is always included; the others are a random
sample (fixed seed) of the remaining eligible clients, so they are not hand-picked.
"""
import json
import os

import numpy as np
import pandas as pd

from benchmark.config import BASE_DIR, PATH
from benchmark.dayahead.features import CLIENTS_PATH

MAIN_CLIENT = "MT_200"
N_OTHERS = 9
SEED = 42
WINDOW = ("2012-01-01", "2014-12-31 23:45")
MAX_ZERO_DAYS = 0.01
MIN_MEAN_KW = 100.0
SELECTION = os.path.join(BASE_DIR, "results", "multiclient", "selection.json")


def main():
    raw = pd.read_csv(os.path.join(BASE_DIR, PATH["raw_data_folder"], "LD2011_2014.txt"), sep=";", decimal=",", low_memory=False)
    raw = raw.rename(columns={raw.columns[0]: "timestamp"})
    raw["timestamp"] = pd.to_datetime(raw["timestamp"])
    raw = raw.set_index("timestamp")

    window = raw.loc[WINDOW[0]:WINDOW[1]]
    zero_days = (window.groupby(window.index.normalize()).sum() <= 0).mean()
    mean = window.mean()
    eligible = sorted(c for c in raw.columns if zero_days[c] <= MAX_ZERO_DAYS and mean[c] >= MIN_MEAN_KW)
    others = [c for c in eligible if c != MAIN_CLIENT]
    sample = sorted(np.random.default_rng(SEED).choice(others, size=N_OTHERS, replace=False).tolist())
    clients = [MAIN_CLIENT, *sample]

    # Zero readings are not consumption (before metering starts, the skipped DST hour): NaN, as in the main ETL
    series = raw[clients].where(raw[clients] > 0)
    series.to_parquet(CLIENTS_PATH)

    os.makedirs(os.path.dirname(SELECTION), exist_ok=True)
    info = {"rule": {"window": WINDOW, "max_zero_day_share": MAX_ZERO_DAYS, "min_mean_kw": MIN_MEAN_KW, "seed": SEED},
            "clients_total": int(raw.shape[1]), "eligible": len(eligible), "clients": clients,
            "mean_kw": {c: round(float(mean[c]), 1) for c in clients}}
    with open(SELECTION, "w") as f:
        json.dump(info, f, indent=2)
    print(f"{raw.shape[1]} clients; {len(eligible)} eligible; selected {clients}")
    print({c: info["mean_kw"][c] for c in clients})
    print(f"Saved {CLIENTS_PATH} and {SELECTION}")


if __name__ == "__main__":
    main()
