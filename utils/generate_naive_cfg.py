from config.params import BASE_DIR, PATH, NAIVE_PARAMS
from itertools import product
import json
import os


def generate_naive_cfg(path):
    """Configurations for the naive baselines: one per lag feature and dataset size."""
    cfg_list = []
    combinations = product(NAIVE_PARAMS["dataset_sizes"], NAIVE_PARAMS["random_seeds"], NAIVE_PARAMS["lag_cols"])
    for i, (ds, seed, lag_col) in enumerate(combinations, 1):
        cfg_list.append({
            "exp_name": f"naive_ds{ds}_{lag_col}_{i:03d}",
            **NAIVE_PARAMS["base_cfg"],
            "dataset_size": ds,
            "random_seed": seed,
            "lag_col": lag_col,
        })

    with open(path, "w") as f:
        json.dump(cfg_list, f, indent=2, ensure_ascii=False)

    print(f"Naive baseline configuration generation complete. Total trials: {len(cfg_list)}")
    return cfg_list


if __name__ == "__main__":
    output_path = os.path.join(BASE_DIR, PATH["exp_config_folder"], PATH["naive_cfg"])
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    generate_naive_cfg(output_path)
