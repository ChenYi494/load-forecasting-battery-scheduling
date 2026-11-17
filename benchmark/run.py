import os

# Single-threaded numeric libraries for comparable CPU benchmarks; must be set before numpy/torch load
for var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
    os.environ.setdefault(var, "1")

import argparse
import json
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from multiprocessing import get_context

import pandas as pd
import torch

from benchmark.config import PATH
from benchmark.experiments.run_experiment import run_experiment

config_keys = ["naive_cfg", "linear_cfg", "mlp_cfg", "rf_cfg"]
summary_path = os.path.join(PATH["results_folder"], PATH["summary_results"])


def set_single_thread():
    torch.set_num_threads(1)
    try:
        torch.set_num_interop_threads(1)
    except RuntimeError:
        pass


def run_isolated(cfg):
    """Runs one experiment inside a fresh worker process (see run_all)."""
    set_single_thread()
    return run_experiment(cfg)


def load_configs():
    configs = []
    for key in config_keys:
        path = os.path.join(PATH["exp_config_folder"], PATH[key])
        if not os.path.exists(path):
            raise FileNotFoundError(f"{path} not found; run python -m benchmark.experiments.grids first")
        with open(path) as f:
            configs.extend(json.load(f))
    return configs


def estimate(configs):
    """Time the first and last config of every (model, dataset_size) group and extrapolate."""
    groups = defaultdict(list)
    for cfg in configs:
        groups[(cfg["model"], cfg["dataset_size"])].append(cfg)

    total_s = 0.0
    print(f"{'model':<8}{'size':>8}{'runs':>6}{'sec/run':>10}{'subtotal':>12}")
    for (model, size), cfgs in groups.items():
        samples = [cfgs[0], cfgs[-1]] if len(cfgs) > 1 else cfgs
        times = []
        for cfg in samples:
            start = time.perf_counter()
            run_experiment(cfg)
            times.append(time.perf_counter() - start)
        per_run = sum(times) / len(times)
        subtotal = per_run * len(cfgs)
        total_s += subtotal
        print(f"{model:<8}{size:>8}{len(cfgs):>6}{per_run:>10.1f}{subtotal / 60:>10.1f} min")
    print(f"Estimated total: {total_s / 3600:.1f} h for {len(configs)} runs")


def run_all(configs):
    os.makedirs(PATH["results_folder"], exist_ok=True)
    done = set()
    if os.path.exists(summary_path):
        done = set(pd.read_csv(summary_path)["exp_name"])
        print(f"Resuming: {len(done)} runs already in {summary_path}")

    todo = [cfg for cfg in configs if cfg["exp_name"] not in done]
    # Every experiment gets a brand-new process: memory measured in a shared process
    # is distorted by allocations that earlier runs left behind and later runs reuse
    with ProcessPoolExecutor(max_workers=1, mp_context=get_context("spawn"), max_tasks_per_child=1) as pool:
        for i, cfg in enumerate(todo, 1):
            print(f"[{i}/{len(todo)}] {cfg['exp_name']}", flush=True)
            results = pool.submit(run_isolated, cfg).result()
            # Append each run immediately so an interrupted run can resume
            pd.DataFrame([results]).to_csv(summary_path, mode="a", index=False,
                                           header=not os.path.exists(summary_path))
    print("All runs done. Results:", summary_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the load-forecasting benchmark")
    parser.add_argument("--estimate", action="store_true", help="time a sample of runs and estimate the total")
    args = parser.parse_args()

    set_single_thread()
    configs = load_configs()
    if args.estimate:
        estimate(configs)
    else:
        run_all(configs)
