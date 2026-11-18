import gc
import os
import threading
import time

import numpy as np
import psutil
import torch

from benchmark.config import PATH
from benchmark.training.metrics import rmse, mae
from benchmark.time_tools import format_time

# Latency protocol: predict LATENCY_SAMPLES test rows one at a time, LATENCY_ROUNDS times,
# after one warm-up round; report the median and p95 of the per-row times
LATENCY_SAMPLES = 200
LATENCY_ROUNDS = 5
# Batch protocol: predict the whole test set BATCH_ROUNDS times and report the median
BATCH_ROUNDS = 5
# Process memory (RSS) is sampled this often while training runs
RSS_SAMPLE_INTERVAL_S = 0.01


class PeakRSSMonitor:
    """Samples the process resident set size (RSS) in a background thread and keeps the peak.

    RSS covers memory allocated by native code (PyTorch, scikit-learn, NumPy),
    which Python-level tools such as tracemalloc do not see.
    """

    def __init__(self, interval_s=RSS_SAMPLE_INTERVAL_S):
        self.process = psutil.Process(os.getpid())
        self.interval_s = interval_s
        self.baseline_mb = 0.0
        self.peak_mb = 0.0
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _rss_mb(self):
        return self.process.memory_info().rss / (1024 * 1024)

    def _run(self):
        while not self._stop.is_set():
            self.peak_mb = max(self.peak_mb, self._rss_mb())
            time.sleep(self.interval_s)

    def __enter__(self):
        gc.collect()
        self.baseline_mb = self._rss_mb()
        self.peak_mb = self.baseline_mb
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        self._thread.join()
        self.peak_mb = max(self.peak_mb, self._rss_mb())
        return False


def measure_latency(model_pro, X_test):
    """Per-row prediction latency in milliseconds (median and p95)."""
    rows = X_test[:LATENCY_SAMPLES]
    for i in range(len(rows)):  # warm-up
        model_pro.predict(rows[i:i + 1])

    per_row_ms = []
    for _ in range(LATENCY_ROUNDS):
        for i in range(len(rows)):
            start = time.perf_counter()
            model_pro.predict(rows[i:i + 1])
            per_row_ms.append((time.perf_counter() - start) * 1000)
    return float(np.median(per_row_ms)), float(np.percentile(per_row_ms, 95))


def measure_batch(model_pro, X_test):
    """Whole-test-set prediction time in milliseconds (median of BATCH_ROUNDS runs) and the predictions."""
    times_ms = []
    y_predict = None
    for _ in range(BATCH_ROUNDS):
        start = time.perf_counter()
        y_predict = model_pro.predict(X_test)
        times_ms.append((time.perf_counter() - start) * 1000)
    return float(np.median(times_ms)), y_predict


# training process
def train_and_evaluate(model_pro, X_train, X_val, X_test, y_train, y_val, y_test, cfg):
    exp_name = cfg["exp_name"]
    model_type = cfg["model"]

    # Training, with wall-clock time and sampled peak RSS
    train_start_time = time.time()
    with PeakRSSMonitor() as mem:
        start = time.perf_counter()
        if model_type in ["linear", "rf", "naive"]:
            model_pro.train(X_train, y_train)
            eff_epochs = 1
        elif model_type == "mlp":
            # Validation set drives early stopping
            eff_epochs = model_pro.train(
                X_train, y_train, X_val, y_val,
                epochs=cfg.get("epochs", 50),
                batch_size=cfg.get("batch_size", 32)
            )
        train_time_s = time.perf_counter() - start
    train_end_time = time.time()

    # Inference: per-row latency and whole-test-set time
    latency_median_ms, latency_p95_ms = measure_latency(model_pro, X_test)
    batch_ms, y_predict = measure_batch(model_pro, X_test)

    # Model size on disk (.pth for PyTorch, .pkl for scikit-learn)
    ext = ".pth" if model_type == "mlp" else ".pkl"
    model_dir = PATH["exp_model_folder"]
    os.makedirs(model_dir, exist_ok=True)
    model_path = os.path.join(model_dir, f"{exp_name}_model{ext}")
    model_pro.save(model_path)

    result = {
        "train_start_time": format_time(train_start_time),
        "train_end_time": format_time(train_end_time),
        "train_time_s": round(train_time_s, 6),
        "effective_epochs": eff_epochs,
        "peak_rss_mb": round(mem.peak_mb, 2),
        "rss_delta_mb": round(mem.peak_mb - mem.baseline_mb, 2),
        "model_size_mb": round(model_pro.model_size(model_path), 6),

        "rmse": round(float(rmse(y_test, y_predict)), 4),
        "mae": round(float(mae(y_test, y_predict)), 4),
        "latency_ms_median": round(latency_median_ms, 4),
        "latency_ms_p95": round(latency_p95_ms, 4),
        "batch_inference_ms": round(batch_ms, 3),
        "batch_rows": len(X_test),
    }

    del model_pro
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    return result
