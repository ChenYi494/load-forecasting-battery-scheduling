# Electricity Load Forecasting: Accuracy vs. Compute

How much do linear regression, an MLP and a random forest improve on simply repeating the last value when forecasting the next 15 minutes of electricity load, and what do they cost to train and run?

**Results site:** _[added after deployment]_ — every number on it is computed from `results/summary_results.csv`.

## Key results

Median over configurations and seeds, on one fixed test period (14 Mar 2014 – 1 Jan 2015, 28,025 intervals). RMSE and MAE in kW; memory is the increase in process RSS during training.

| Model | Training rows | RMSE | MAE | Train time (s) | Memory (MB) | Latency per row (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Persistence (value 15 min earlier) | — | 42.3 | 29.4 | — | — | 0.001 |
| Same time yesterday | — | 70.2 | 47.2 | — | — | 0.001 |
| Linear regression | 1,000 | 41.9 | 29.9 | 0.003 | 0.1 | 0.033 |
| | 10,000 | 39.4 | 27.8 | 0.003 | 0.1 | 0.033 |
| | 100,000 | 38.4 | 27.5 | 0.005 | 4.7 | 0.033 |
| MLP | 1,000 | 51.5 | 37.2 | 0.152 | 11.6 | 0.042 |
| | 10,000 | 45.9 | 33.9 | 1.374 | 12.8 | 0.043 |
| | 100,000 | 36.1 | 26.9 | 9.483 | 30.0 | 0.042 |
| Random forest | 1,000 | 84.9 | 54.6 | 0.097 | 4.9 | 2.142 |
| | 10,000 | 82.4 | 50.7 | 0.765 | 55.9 | 2.119 |
| | 100,000 | 39.3 | 28.7 | 8.051 | 212.0 | 2.222 |

Findings:

1. **The best model beats persistence by 19%.** An MLP (128×64, 100,000 training rows) reaches 34.1 kW RMSE against 42.3 kW for repeating the last value. With 1,000 rows, linear regression is barely better than persistence.
2. **Random forests fail outside their training range.** With 1,000 or 10,000 rows, training covers only winter. 12.5% of test loads (summer) exceed the highest training load; a forest cannot predict above it, so its error there is 208 kW against 41 kW elsewhere. Linear regression and the MLP extrapolate through the lag features.
3. **Accuracy costs memory.** At 100,000 rows the random forest needs about 212 MB to train and is 85 MB on disk; linear regression needs under 5 MB.

## Data and task

- [UCI ElectricityLoadDiagrams20112014](https://archive.ics.uci.edu/dataset/321/electricityloaddiagrams20112014): 15-minute load in kW for 370 Portuguese clients, 2011–2014 (CC BY 4.0). This project uses client `MT_200`, 140,123 valid rows.
- Target: load in the next 15-minute interval.
- Features: hour, minute, day of week, weekend flag, `lag_1` (15 minutes earlier), `lag_96` (24 hours earlier).
- This is a retrospective comparison of methods on historical data, not a forecast of current demand.

## Method

| Item | Setting |
| --- | --- |
| Test period | Last 20% of the data, identical for every run |
| Training data | 1,000 / 10,000 / 100,000 rows immediately before the test period; last 10% used for MLP early stopping |
| Scaling | Features standardized with training statistics only; MLP target standardized too |
| Linear regression | OLS and Ridge (α = 0.01, 1, 10) |
| MLP | 64×32, 128×64, 256×128×64; dropout 0 / 0.3; batch 32 / 256; Adam, early stopping (patience 5) |
| Random forest | 50 / 100 trees; depth 10 / 50 / unlimited; all features at each split |
| Seeds | 42, 123, 999 (baselines once per size) — 204 runs in total |
| Latency | 200 test rows predicted one at a time, 5 rounds after a warm-up; median and p95 |
| Memory | Process RSS sampled every 10 ms during training; each run in a fresh process |
| Threads | Single-threaded (PyTorch, BLAS, scikit-learn) |
| Machine | Apple M2 Pro, 16 GB, macOS 15.6, Python 3.12 |

## Revisions

The benchmark was first built in **March 2026**. A review in **November 2026** found errors in the evaluation; every run was repeated after fixing them. The March results are kept in `results/before/` for comparison.

| Problem in March | Fix |
| --- | --- |
| Each training size was tested on a different period | One fixed test period |
| MLP early stopping kept a reference to the weights, not a copy, and did not restore the best weights | Deep copy, always restored |
| Lag features were built after removing zero readings, misaligning `lag_96` near gaps | Lags computed on the full timeline |
| Unscaled MLP target, unshuffled batches, no PyTorch seed | Fixed |
| Latency was one `time.time()` call around the whole test set | Per-row `perf_counter` timing |
| Memory from `tracemalloc` in one shared process | RSS sampling, one process per run |
| No naive baseline; custom "efficiency score" | Persistence and same-time-yesterday baselines; score removed |
| Streamlit dashboard with hard-coded verdicts and MW units | Replaced by the static results site; kW |

Conclusions that changed: the MLP's March error at 1,000 rows (118 kW) was a bug, and the small random forest went from best to worst once it had to forecast a later season. March numbers came from different test periods, so they are not a like-for-like comparison.

## Run it

Python 3.12 and Node 22.

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python -m benchmark.data.download      # UCI data into data/raw/, SHA-256 checked
python -m benchmark.data.prepare       # features -> data/source_data.parquet
python -m benchmark.experiments.grids  # experiment grids -> benchmark/experiments/configs/
python -m benchmark.run --estimate     # optional: estimate run time
python -m benchmark.run                # 204 runs -> results/summary_results.csv (resumable)
python -m benchmark.export             # -> web/public/results.json

cd web && npm install && npm run dev   # results site at http://localhost:5173
```

`data/source_data.parquet` is committed, so the download and preparation steps can be skipped. `python -m benchmark.check_splits` prints the train and test windows for each training size.

## Repository

```
benchmark/                  experiment code (Python package)
├── config.py               paths and experiment grids
├── data/                   download, prepare (features), dataset (fixed test window, scaling)
├── models/                 naive baselines, linear, MLP, random forest
├── training/               training loop, timing and memory measurement, metrics
├── experiments/            grids, one run, generated configs
├── run.py                  runs every config, each in its own process
├── export.py               results -> web/public/results.json
└── check_splits.py · hardware.py · time_tools.py
data/                       source_data.parquet (raw download in data/raw/, not committed)
results/                    summary_results.csv (current), before/ (March 2026)
web/                        results site (React, TypeScript, ECharts)
```

## Limitations

- One client and one test period; a rolling evaluation or other load profiles may give different results.
- Next-15-minute forecasting with `lag_1` is easy for linear models, which is why persistence is hard to beat. Day-ahead forecasting would be harder.
- Timings come from one laptop; absolute values will differ on other hardware.
- Memory includes temporary training allocations, not only the model.
- Hyperparameter grids are small; no model was tuned beyond them.
