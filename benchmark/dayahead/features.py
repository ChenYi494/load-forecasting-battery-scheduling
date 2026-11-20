"""Day-ahead features: everything known at 23:45 on the day before the forecast day.

A battery schedule for day D is fixed before D starts, so every feature for a 15-minute slot of
day D may only use loads from day D-1 or earlier.
"""
import os

import numpy as np
import pandas as pd

from benchmark.config import BASE_DIR, COMMON_BASE

SLOTS_PER_DAY = 96

# lag name -> number of 15-minute steps back; every lag is at least one full day
LAGS = {"lag_96": 96, "lag_192": 192, "lag_672": 672}
CALENDAR = ["hour", "minute", "day_of_week", "is_weekend"]
DAILY = ["prev_day_mean", "prev_day_max"]
FEATURES = CALENDAR + list(LAGS) + DAILY

# First day of the test period: the first full day inside the fixed test window of task A
TEST_START_DAY = pd.Timestamp("2014-03-15")


CLIENTS_PATH = os.path.join(BASE_DIR, "data", "clients.parquet")


def load_series(client=None):
    """Load on a complete 15-minute grid; intervals removed by the ETL (zero readings) become NaN.

    client=None reads MT_200 from the main dataset; any other client is read from data/clients.parquet
    (written by benchmark.multiclient.select), where zero readings are already NaN.
    """
    if client is not None:
        return pd.read_parquet(CLIENTS_PATH, columns=[client])[client].rename("load")
    df = pd.read_parquet(os.path.join(BASE_DIR, COMMON_BASE["dataset_path"]), columns=["timestamp", "load"])
    grid = pd.date_range(df["timestamp"].min(), df["timestamp"].max(), freq="15min")
    return df.set_index("timestamp")["load"].reindex(grid)


def build_features(load):
    """One row per 15-minute slot with the target and the day-ahead features."""
    out = pd.DataFrame({"load": load})
    ts = out.index
    out["day"] = ts.normalize()
    out["hour"] = ts.hour
    out["minute"] = ts.minute
    out["day_of_week"] = ts.day_of_week
    out["is_weekend"] = (out["day_of_week"] >= 5).astype(int)
    for name, steps in LAGS.items():
        out[name] = load.shift(steps)

    # Statistics of the whole previous calendar day, joined to every slot of the next day
    daily = load.groupby(ts.normalize()).agg(["mean", "max"])
    daily.index = daily.index + pd.Timedelta(days=1)
    out["prev_day_mean"] = out["day"].map(daily["mean"])
    out["prev_day_max"] = out["day"].map(daily["max"])
    return out


def fill_missing_lags(frame):
    """A lag can point at a removed interval; fall back to another lag from the past, then to the previous day's mean."""
    filled = frame.copy()
    n_missing = int(filled[list(LAGS)].isna().any(axis=1).sum())
    filled["lag_96"] = filled["lag_96"].fillna(filled["lag_672"]).fillna(filled["prev_day_mean"])
    filled["lag_192"] = filled["lag_192"].fillna(filled["lag_96"])
    filled["lag_672"] = filled["lag_672"].fillna(filled["lag_96"])
    return filled, n_missing


def split(frame):
    """Training rows end before the first test day; test days must have all 96 actual values."""
    train = frame[frame.index < TEST_START_DAY].dropna(subset=["load", *FEATURES])
    test = frame[frame.index >= TEST_START_DAY]
    complete_days = test.groupby("day")["load"].count()
    complete_days = complete_days[complete_days == SLOTS_PER_DAY].index
    skipped = int(test["day"].nunique() - len(complete_days))
    test = test[test["day"].isin(complete_days)]
    return train, test, skipped


def feature_sources(frame):
    """Latest timestamp each feature reads for every row (used by the leakage test)."""
    ts = frame.index.to_series()
    sources = {name: ts - pd.Timedelta(minutes=15 * steps) for name, steps in LAGS.items()}
    end_prev_day = frame["day"] - pd.Timedelta(minutes=15)
    for name in DAILY:
        sources[name] = end_prev_day
    return pd.DataFrame(sources, index=frame.index)


if __name__ == "__main__":
    f = build_features(load_series())
    train, test, skipped = split(f)
    print(f"train rows {len(train)} ({train.index.min()} -> {train.index.max()})")
    print(f"test days {test['day'].nunique()} ({test.index.min()} -> {test.index.max()}), incomplete days skipped {skipped}")
    print("features:", ", ".join(FEATURES))
    print("rows with a missing lag in the test period:", int(test[list(LAGS)].isna().any(axis=1).sum()))
    print(np.round(train[FEATURES].describe().loc[["mean", "min", "max"]], 1).to_string())
