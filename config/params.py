import os

# Project root directory
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Centralized path configuration
PATH = {
    # 目錄
    "dataset_folder": "data",
    "raw_data_folder": "data/raw",
    "exp_config_folder": "experiments/configs",
    "exp_result_folder": "experiments/results",
    "exp_model_folder": "experiments/results/models",
    "exp_log_folder": "experiments/results/train_logs",
    "results_folder": "results",
    # 檔案
    "source_data": "source_data.parquet",
    "linear_cfg": "linear.json",
    "mlp_cfg": "mlp.json",
    "rf_cfg": "rf.json",
    "naive_cfg": "naive.json",
    "summary_results": "summary_results.csv"
}

# Base configuration shared across all model types
COMMON_BASE = {
    "dataset_path": os.path.join(PATH['dataset_folder'], PATH['source_data']),
    "target_col": "load",
    "train_ratio": 0.8,
    "shuffle": False,
}

# Linear regression: OLS and Ridge (L2)
LINEAR_PARAMS = {
    # Static configuration
    "base_cfg": {
        **COMMON_BASE,
        "model": "linear",
    },
    # Hyperparameter search space
    "dataset_sizes": [1000, 10000, 100000],
    "random_seeds": [42, 123, 999],
    # "none" = OLS; each alpha = one Ridge configuration
    "alphas": [0.01, 1.0, 10.0]
}

# Multi-layer perceptron (PyTorch, Adam, early stopping with patience 5)
MLP_PARAMS = {
    # Static configuration
    "base_cfg": {
        **COMMON_BASE,
        "model": "mlp",
        "learning_rate": 1e-03,
        "epochs": 200,
    },
    # Architecture and capacity scaling parameters
    "dataset_sizes": [1000, 10000, 100000],
    "random_seeds": [42, 123, 999],
    "hidden_layers": [[64, 32], [128, 64], [256, 128, 64]],
    "dropouts": [0.0, 0.3],
    "batch_sizes": [32, 256],
}

# Random forest
RF_PARAMS = {
    # Static configuration
    "base_cfg": {
        **COMMON_BASE,
        "model": "rf",
        "min_samples_leaf": 1,
        # Consider all 6 features at every split; "sqrt" (the March setting) saw only 2,
        # so most splits could not use lag_1, the strongest predictor
        "max_features": 1.0,
    },
    # Complexity and inference jitter parameters
    "dataset_sizes": [1000, 10000, 100000],
    "random_seeds": [42, 123, 999],
    "n_estimators": [50, 100],
    "max_depth": [10, 50, None]
}

# Naive baselines (no training): persistence (lag_1) and same time yesterday (lag_96).
# They ignore the seed and the training size; one run per size keeps every table complete.
NAIVE_PARAMS = {
    "base_cfg": {
        **COMMON_BASE,
        "model": "naive",
    },
    "dataset_sizes": [1000, 10000, 100000],
    "random_seeds": [42],
    "lag_cols": ["lag_1", "lag_96"],
}
