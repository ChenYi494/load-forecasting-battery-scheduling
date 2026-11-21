import numpy as np
import pandas as pd

from benchmark.decision.battery import Battery
from benchmark.decision.dp import schedule_day

BATTERY = Battery(capacity_kwh=400.0, power_kw=200.0, round_trip_efficiency=0.9)


def test_flatten_charges_at_low_load_when_prices_tie():
    # Flat off-peak price all morning, peak in the evening; load is low at night and high at midday
    price = np.r_[np.full(64, 2.5), np.full(32, 6.5)]
    load = np.r_[np.full(32, 300.0), np.full(32, 900.0), np.full(32, 800.0)]
    plain = schedule_day(load, price, 2000.0, BATTERY, 0.0)
    flat = schedule_day(load, price, 2000.0, BATTERY, 0.0, flatten=1e-4)
    assert flat.charge_kw[32:64].sum() == 0                       # no charging at the high midday load
    assert flat.charge_kw[:32].sum() > 0
    # Same discharge in the evening: the price-driven decisions do not change
    assert np.isclose(flat.discharge_kw[64:].sum(), plain.discharge_kw[64:].sum())


def test_flatten_discharges_at_the_highest_load_in_a_flat_price_block():
    # One price block all afternoon; the load peaks late in the block, under the contract
    price = np.r_[np.full(32, 2.5), np.full(64, 6.5)]
    load = np.r_[np.full(32, 500.0), np.full(32, 900.0), np.full(32, 1200.0)]
    flat = schedule_day(load, price, 2000.0, BATTERY, 0.0, flatten=1e-4)
    assert flat.discharge_kw[64:].sum() > 0 and flat.discharge_kw[32:64].sum() == 0
