"""Expands the parameter grids in benchmark/config.py into one JSON file of runs per model.

    python -m benchmark.experiments.grids
"""
import json
import os
from itertools import product

from benchmark.config import BASE_DIR, LINEAR_PARAMS, MLP_PARAMS, NAIVE_PARAMS, PATH, RF_PARAMS


def naive_grid():
    """Naive baselines: one run per lag feature and dataset size."""
    combos = product(NAIVE_PARAMS["dataset_sizes"], NAIVE_PARAMS["random_seeds"], NAIVE_PARAMS["lag_cols"])
    return [{
        "exp_name": f"naive_ds{ds}_{lag_col}_{i:03d}",
        **NAIVE_PARAMS["base_cfg"],
        "dataset_size": ds,
        "random_seed": seed,
        "lag_col": lag_col,
    } for i, (ds, seed, lag_col) in enumerate(combos, 1)]


def linear_grid():
    """OLS ("none", no alpha) plus one Ridge ("L2") configuration per alpha."""
    schemes = [{"reg": "none", "alpha": None}] + [{"reg": "L2", "alpha": a} for a in LINEAR_PARAMS["alphas"]]
    combos = product(LINEAR_PARAMS["dataset_sizes"], LINEAR_PARAMS["random_seeds"], schemes)
    runs = []
    for i, (ds, seed, scheme) in enumerate(combos, 1):
        alpha_str = f"a{scheme['alpha']}" if scheme["alpha"] is not None else "na"
        runs.append({
            "exp_name": f"linear_ds{ds}_s{seed}_{scheme['reg']}_{alpha_str}_{i:03d}",
            **LINEAR_PARAMS["base_cfg"],
            "dataset_size": ds,
            "random_seed": seed,
            "regularization": scheme["reg"],
            "alpha": scheme["alpha"],
        })
    return runs


def mlp_grid():
    combos = product(MLP_PARAMS["dataset_sizes"], MLP_PARAMS["random_seeds"], MLP_PARAMS["hidden_layers"],
                     MLP_PARAMS["dropouts"], MLP_PARAMS["batch_sizes"])
    return [{
        "exp_name": f"mlp_ds{ds}_s{seed}_{'x'.join(map(str, layers))}_d{drop}_b{batch}_{i:03d}",
        **MLP_PARAMS["base_cfg"],
        "dataset_size": ds,
        "random_seed": seed,
        "hidden_layers": layers,
        "dropout": drop,
        "batch_size": batch,
    } for i, (ds, seed, layers, drop, batch) in enumerate(combos, 1)]


def rf_grid():
    combos = product(RF_PARAMS["dataset_sizes"], RF_PARAMS["random_seeds"], RF_PARAMS["n_estimators"],
                     RF_PARAMS["max_depth"])
    return [{
        "exp_name": f"rf_ds{ds}_s{seed}_n{nest}_d{'unlimit' if depth is None else depth}_{i:03d}",
        **RF_PARAMS["base_cfg"],
        "dataset_size": ds,
        "random_seed": seed,
        "n_estimators": nest,
        "max_depth": depth,
    } for i, (ds, seed, nest, depth) in enumerate(combos, 1)]


GRIDS = {"naive_cfg": naive_grid, "linear_cfg": linear_grid, "mlp_cfg": mlp_grid, "rf_cfg": rf_grid}


def write_all():
    folder = os.path.join(BASE_DIR, PATH["exp_config_folder"])
    os.makedirs(folder, exist_ok=True)
    for key, build in GRIDS.items():
        runs = build()
        with open(os.path.join(folder, PATH[key]), "w", encoding="utf-8") as f:
            json.dump(runs, f, indent=2, ensure_ascii=False)
        print(f"{PATH[key]}: {len(runs)} runs")


if __name__ == "__main__":
    write_all()
