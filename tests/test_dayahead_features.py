import pandas as pd

from benchmark.dayahead.features import FEATURES, build_features, feature_sources, load_series, split


def test_features_only_use_previous_days():
    frame = build_features(load_series())
    sources = feature_sources(frame)
    start_of_day = frame["day"]
    # Every feature must read data strictly before 00:00 of the forecast day
    for name in sources.columns:
        assert (sources[name] < start_of_day).all(), name


def test_lag_values_match_the_series():
    load = load_series()
    frame = build_features(load)
    t = pd.Timestamp("2013-06-12 14:30")
    assert frame.loc[t, "lag_96"] == load[t - pd.Timedelta(days=1)]
    assert frame.loc[t, "lag_672"] == load[t - pd.Timedelta(days=7)]
    assert frame.loc[t, "prev_day_max"] == load[pd.Timestamp("2013-06-11"):pd.Timestamp("2013-06-11 23:45")].max()


def test_split_has_no_overlap_and_full_days():
    train, test, _ = split(build_features(load_series()))
    assert train.index.max() < test.index.min()
    assert (test.groupby("day").size() == 96).all()
    assert not train[FEATURES].isna().any().any()
