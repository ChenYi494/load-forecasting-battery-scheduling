from config.params import COMMON_BASE, LINEAR_PARAMS
from data.dataset import load_dataset

# Prints the train and test windows for each dataset size; the test window must be identical
if __name__ == "__main__":
    for size in LINEAR_PARAMS["dataset_sizes"]:
        X_train, X_val, X_test, *_, spans = load_dataset(
            COMMON_BASE["dataset_path"], COMMON_BASE["target_col"], 1 - COMMON_BASE["train_ratio"], size
        )
        print(f"size={size:>6}  train={len(X_train):>6} val={len(X_val):>5} test={len(X_test):>5}  "
              f"train {spans['train_start']} -> {spans['train_end']}  |  test {spans['test_start']} -> {spans['test_end']}")
