import pandas as pd
from sklearn.preprocessing import StandardScaler


# Load dataset from Parquet, split it in time order, and standardize features.
def load_dataset(dataset_path, target_col, test_ratio=0.2, dataset_size=0, shuffle=False):
    """
    Args:
        dataset_path: Path to the source Parquet file
        target_col: The dependent variable (label) for forecasting
        test_ratio: Share of the FULL dataset reserved as the test window (the latest rows)
        dataset_size: Number of training rows (train + validation) taken right before the test window;
                      0 uses every row before the test window
        shuffle: Kept for config compatibility; must be False for time series
    """
    if shuffle:
        raise ValueError("shuffle=True would leak future data into training")

    df = pd.read_parquet(dataset_path)
    df.columns = df.columns.str.strip()

    # Fixed test window: the latest test_ratio of the full dataset.
    # It is the same for every dataset_size, so results across sizes are comparable.
    n_test = int(round(len(df) * test_ratio))
    test_df = df.iloc[-n_test:]
    pool_df = df.iloc[:-n_test]

    # Training pool: the dataset_size rows closest to the test window
    if dataset_size > 0:
        if dataset_size > len(pool_df):
            raise ValueError(f"dataset_size={dataset_size} exceeds the {len(pool_df)} rows before the test window")
        pool_df = pool_df.iloc[-dataset_size:]

    # Validation: the latest 10% of the training pool (used for MLP early stopping)
    n_val = int(round(len(pool_df) * 0.1))
    train_df = pool_df.iloc[:-n_val]
    val_df = pool_df.iloc[-n_val:]

    def split_xy(part):
        X = part.select_dtypes(include=['number']).drop(columns=[target_col], errors='ignore')
        return X, part[target_col].values

    X_train, y_train = split_xy(train_df)
    X_val, y_val = split_xy(val_df)
    X_test, y_test = split_xy(test_df)

    # Z-score scaling fitted on training rows only
    scaler = StandardScaler()
    X_train = scaler.fit_transform(X_train)
    X_val = scaler.transform(X_val)
    X_test = scaler.transform(X_test)

    spans = {
        "train_start": str(train_df['timestamp'].iloc[0]),
        "train_end": str(val_df['timestamp'].iloc[-1]),
        "test_start": str(test_df['timestamp'].iloc[0]),
        "test_end": str(test_df['timestamp'].iloc[-1]),
        # Needed by the naive baselines to map standardized lag features back to kW
        "feature_names": list(scaler.feature_names_in_),
        "feature_mean": scaler.mean_.tolist(),
        "feature_scale": scaler.scale_.tolist(),
    }
    return X_train, X_val, X_test, y_train, y_val, y_test, spans
