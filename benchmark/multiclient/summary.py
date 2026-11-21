"""Summarize the multi-client check.

    python -m benchmark.multiclient.summary

For each client: how much the forecast choice moves the share of the perfect-foresight saving,
compared with the spread across seeds of one model; how much the discharge-at-highest-load plan
adds; and whether ranking forecasts by RMSE gives the same order as ranking them by the bill.
"""
import glob
import json
import os

import pandas as pd
from scipy.stats import spearmanr

from benchmark.multiclient.run import OUT_DIR
from benchmark.multiclient.select import SELECTION

METHODS = ["naive_yesterday", "naive_last_week", "linear", "mlp", "rf"]


def load():
    backtest = pd.concat(pd.read_csv(p) for p in sorted(glob.glob(os.path.join(OUT_DIR, "*_backtest.csv"))))
    accuracy = pd.concat(pd.read_csv(p) for p in sorted(glob.glob(os.path.join(OUT_DIR, "*_accuracy.csv"))))
    return backtest, accuracy


def per_client(backtest, accuracy):
    rows = []
    for client, b in backtest.groupby("client", sort=False):
        a = accuracy[accuracy["client"] == client].groupby("method")[["rmse", "peak_mae"]].mean()
        plain = b[b["planner"] == "plain"].set_index("strategy")
        row = {"client": client, "mean_load_kw": b["mean_load_kw"].iloc[0],
               "contract_no_battery_kw": plain.loc["no_battery", "contract_kw"],
               "contract_battery_kw": plain.loc["perfect_foresight", "contract_kw"],
               "perfect_saving_pct": plain.loc["perfect_foresight", "saving_pct"]}
        for planner, g in b[b["method"].isin(METHODS)].groupby("planner"):
            share = g.groupby("method")["share_of_perfect"]
            means = share.mean().reindex(METHODS)
            row[f"{planner}_min"] = means.min()
            row[f"{planner}_max"] = means.max()
            row[f"{planner}_model_gap"] = means.max() - means.min()
            row[f"{planner}_seed_spread"] = (share.max() - share.min()).max()
            row[f"{planner}_best"] = means.idxmax()
            # Lower RMSE should mean a higher share if accuracy ranks the decisions
            row[f"{planner}_rank_corr_rmse"] = spearmanr(-a.loc[METHODS, "rmse"], means).statistic
            row[f"{planner}_rank_corr_peak"] = spearmanr(-a.loc[METHODS, "peak_mae"], means).statistic
            for m in METHODS:
                row[f"{planner}_{m}"] = means[m]
        row["flatten_gain_mean"] = sum(row[f"flatten_{m}"] - row[f"plain_{m}"] for m in METHODS) / len(METHODS)
        row["best_rmse"] = a.loc[METHODS, "rmse"].idxmin()
        rows.append(row)
    return pd.DataFrame(rows)


def main():
    backtest, accuracy = load()
    table = per_client(backtest, accuracy)
    with open(SELECTION) as f:
        order = json.load(f)["clients"]
    table = table.set_index("client").reindex([c for c in order if c in set(table["client"])]).reset_index()
    table.round(3).to_csv(os.path.join(OUT_DIR, "summary.csv"), index=False)

    show = ["client", "mean_load_kw", "perfect_saving_pct", "plain_min", "plain_max", "plain_seed_spread",
            "flatten_min", "flatten_max", "flatten_seed_spread", "flatten_gain_mean", "best_rmse", "plain_best", "flatten_best"]
    print(table[show].round(1).to_string(index=False))
    print("\nRank correlation between accuracy and bill (Spearman over the 5 methods; 1 = same order):")
    print(table[["client", "plain_rank_corr_rmse", "flatten_rank_corr_rmse", "plain_rank_corr_peak", "flatten_rank_corr_peak"]].round(2).to_string(index=False))
    n = len(table)
    print(f"\n{n} clients")
    print(f"  discharge-at-highest-load helps every method on {int((table[[f'flatten_{m}' for m in METHODS]].to_numpy() > table[[f'plain_{m}' for m in METHODS]].to_numpy()).all(axis=1).sum())} clients; mean gain {table['flatten_gain_mean'].mean():.1f} points (range {table['flatten_gain_mean'].min():.1f} to {table['flatten_gain_mean'].max():.1f})")
    for planner in ("plain", "flatten"):
        bigger = int((table[f"{planner}_model_gap"] > table[f"{planner}_seed_spread"]).sum())
        print(f"  {planner}: gap between models larger than the seed spread on {bigger}/{n} clients; "
              f"median model gap {table[f'{planner}_model_gap'].median():.1f} points; "
              f"median Spearman(RMSE, bill) {table[f'{planner}_rank_corr_rmse'].median():.2f}; "
              f"best method counts {table[f'{planner}_best'].value_counts().to_dict()}")
    print(f"  lowest RMSE counts {table['best_rmse'].value_counts().to_dict()}")
    print("\nMean share over clients (%):")
    print(pd.DataFrame({p: [table[f"{p}_{m}"].mean() for m in METHODS] for p in ("plain", "flatten")}, index=METHODS).round(1).to_string())
    print(f"\nSaved {os.path.join(OUT_DIR, 'summary.csv')}")


if __name__ == "__main__":
    main()
