import json
import random
import numpy as np
import torch
from benchmark.data.dataset import load_dataset
from benchmark.models.linear_regression import LinearModel
from benchmark.models.fully_connected_MLP import MLPModel
from benchmark.models.random_forest import RFModel
from benchmark.models.naive import NaiveModel
from benchmark.training.trainer import train_and_evaluate
from benchmark.hardware import get_hardware_profile

# experiment process
def run_experiment(cfg):
    # Step 0: Global Seed Initialization
    # Ensures experimental reproducibility across stochastic operations
    seed = cfg["random_seed"]
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)

    # Step 1: Data Acquisition
    # Temporal splitting is handled within load_dataset to prevent data leakage
    X_train, X_val, X_test, y_train, y_val, y_test, spans = load_dataset(
        cfg["dataset_path"], cfg["target_col"], 1- cfg["train_ratio"], cfg["dataset_size"], cfg["shuffle"]
    )

    # Model-Specific Data Routing
    if cfg["model"] in ["rf", "linear", "naive"]:
        # Merge validation set back into training for models that do not require
        # real-time monitoring (Early Stopping), maximizing sample utilization.
        X_train = np.r_[X_train, X_val]
        y_train = np.r_[y_train, y_val]
        print(f"[{cfg['model'].upper()}] Validation set merged into training. Total samples: {len(X_train)}")

    # Step 2: Model Factory Initialization
    model_pro = get_model(cfg, X_train, spans)

    # Step 3: Training and Resource Profiling
    results = train_and_evaluate(
        model_pro, X_train, X_val, X_test, y_train, y_val, y_test, cfg
    )

    # Final Quantitative Summary Construction
    actual_val_size = 0 if cfg["model"] in ["rf", "linear", "naive"] else len(X_val)
    summary = {
        # === Metadata & Environment ===
        "exp_name": cfg["exp_name"],
        "hardware_profile": json.dumps(get_hardware_profile()),

        # === Experimental Design ===
        "model": cfg["model"],
        "dataset_size": cfg["dataset_size"],
        "train_size": len(X_train),
        "test_size": len(X_test),
        "val_size": actual_val_size,
        "feature_num": X_train.shape[1],
        "complexity": model_pro.complexity(),
        "hyperparameters": model_pro.get_hyperparameters(),
        "seed": seed,
        "train_start": spans["train_start"],
        "train_end": spans["train_end"],
        "test_start": spans["test_start"],
        "test_end": spans["test_end"],

        # === Compute cost (see training/trainer.py for the measurement protocol) ===
        "train_time_s": results["train_time_s"],
        "effective_epochs": results["effective_epochs"],
        "peak_rss_mb": results["peak_rss_mb"],
        "rss_delta_mb": results["rss_delta_mb"],
        "model_size_mb": results["model_size_mb"],
        "latency_ms_median": results["latency_ms_median"],
        "latency_ms_p95": results["latency_ms_p95"],
        "batch_inference_ms": results["batch_inference_ms"],
        "batch_rows": results["batch_rows"],

        # === Accuracy (kW) ===
        "rmse": results["rmse"],
        "mae": results["mae"],
    }

    return summary


def get_model(cfg, X_train, spans):
    if cfg["model"] == "linear":
        return LinearModel(
            reg_type=cfg.get("regularization", "none"),
            alpha=cfg.get("alpha", 1.0)
        )
    elif cfg["model"] == "mlp":
        input_dim = X_train.shape[1]  # Automated feature dimension mapping
        return MLPModel(
        input_dim=input_dim,
        hidden_layers=cfg["hidden_layers"],
        dropout=cfg["dropout"],
        lr=cfg["learning_rate"]
    )
    elif cfg["model"] == "rf":
        return RFModel(
            n_estimators=cfg["n_estimators"],
            max_depth=cfg["max_depth"],
            min_samples_leaf=cfg.get("min_samples_leaf", 1),
            max_features=cfg.get("max_features", 1.0),
            random_seed=cfg["random_seed"]
        )
    elif cfg["model"] == "naive":
        return NaiveModel(
            lag_col=cfg["lag_col"],
            feature_names=spans["feature_names"],
            feature_mean=spans["feature_mean"],
            feature_scale=spans["feature_scale"]
        )
    else:
        return "unknown"