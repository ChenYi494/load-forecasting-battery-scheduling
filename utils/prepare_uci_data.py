import os
import pandas as pd
from config.params import BASE_DIR, PATH

TARGET_USER = "MT_200"
MAX_ROWS = 110000  # same cap as the March version, so results stay comparable


def prepare_uci_data():
    # Load raw dataset (European number format: decimal=',' and ';' delimiters)
    file_path = os.path.join(BASE_DIR, PATH["raw_data_folder"], "LD2011_2014.txt")
    # The first column has an empty header and holds the timestamps
    df = pd.read_csv(file_path, sep=';', decimal=',', low_memory=False,
                     usecols=lambda c: c.startswith('Unnamed') or c in ('', TARGET_USER))
    df = df.rename(columns={df.columns[0]: 'timestamp', TARGET_USER: 'load'})
    df['timestamp'] = pd.to_datetime(df['timestamp'])

    # The raw file is a complete 15-minute grid; lags below rely on that
    steps = df['timestamp'].diff().dropna().unique()
    if len(steps) != 1 or steps[0] != pd.Timedelta(minutes=15):
        raise ValueError(f"Expected a regular 15-minute timeline, found steps: {steps}")

    # Lag features on the full timeline, BEFORE removing any rows,
    # so lag_1 is always 15 minutes earlier and lag_96 always 24 hours earlier
    df['lag_1'] = df['load'].shift(1)
    df['lag_96'] = df['load'].shift(96)

    # Calendar features
    df['hour'] = df['timestamp'].dt.hour
    df['minute'] = df['timestamp'].dt.minute
    df['day_of_week'] = df['timestamp'].dt.day_of_week
    df['is_weekend'] = (df['day_of_week'] >= 5).astype(int)

    # Remove rows without a valid target or valid lags.
    # Zero readings are not real consumption: before metering starts, and the hour skipped
    # when clocks move forward in March (documented by UCI).
    total = len(df)
    valid = (df['load'] > 0) & (df['lag_1'] > 0) & (df['lag_96'] > 0)
    df_clean = df[valid].reset_index(drop=True)
    removed = total - len(df_clean)

    df_final = df_clean.head(MAX_ROWS)
    columns = ['timestamp', 'load', 'hour', 'minute', 'day_of_week', 'is_weekend', 'lag_1', 'lag_96']
    df_final = df_final[columns]

    output_path = os.path.join(BASE_DIR, PATH['dataset_folder'], PATH['source_data'])
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    df_final.to_parquet(output_path, compression='snappy', index=False)

    print(f"Saved: {output_path}")
    print(f"Raw rows: {total}; removed (zero or missing load/lags): {removed}; kept: {len(df_final)} (cap {MAX_ROWS})")
    print(f"Time span: {df_final['timestamp'].min()} to {df_final['timestamp'].max()}")


if __name__ == "__main__":
    prepare_uci_data()
