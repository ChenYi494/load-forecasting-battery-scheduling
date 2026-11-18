import numpy as np
import pandas as pd
import pytest

from benchmark.decision.battery import Battery
from benchmark.decision.dp import schedule_day
from benchmark.decision.lp_check import solve_day_lp
from benchmark.decision.settle import actual_grid, monthly_bill
from benchmark.decision.tariff import load_tariff, tariff_from_dict

# A synthetic tariff for testing the algorithms only; the real values live in configs/tariff.yaml
TEST_TARIFF = {
    "name": "test", "currency": "TWD",
    "source": {"document": "synthetic", "url": "n/a", "retrieved": "n/a"},
    "summer": {"start": "06-01", "end": "09-30"},
    "basic_charge_per_kw_month": {"summer": 200.0, "non_summer": 150.0},
    "off_peak_contract_per_kw_month": {"summer": 40.0, "non_summer": 30.0},
    "energy_charge_per_kwh": {
        "summer": {"peak": 6.0, "semi_peak": 4.0, "off_peak": 2.0},
        "non_summer": {"peak": 5.0, "semi_peak": 3.5, "off_peak": 2.0},
    },
    "periods": {
        "summer": {"weekday": [{"from": "09:00", "to": "24:00", "period": "peak"}],
                   "saturday": [{"from": "09:00", "to": "24:00", "period": "semi_peak"}], "sunday": []},
        "non_summer": {"weekday": [{"from": "06:00", "to": "11:00", "period": "peak"},
                                   {"from": "14:00", "to": "24:00", "period": "peak"}],
                       "saturday": [], "sunday": []},
    },
    "excess_penalty": {"within_10pct": 2, "beyond_10pct": 3},
}
TARIFF = tariff_from_dict(TEST_TARIFF)
BATTERY = Battery(capacity_kwh=800.0, power_kw=200.0, round_trip_efficiency=0.9)
DAY = pd.date_range("2014-07-08", periods=96, freq="15min")       # a summer Tuesday


def daily_load(seed=0):
    rng = np.random.default_rng(seed)
    hours = np.arange(96) / 4
    return 500 + 400 * np.exp(-((hours - 15) / 4) ** 2) + rng.normal(0, 20, 96)


@pytest.mark.parametrize("seed", [0, 1, 2])
def test_dp_matches_lp_optimum(seed):
    load = daily_load(seed)
    price, weight = TARIFF.energy_price(DAY), 3 * TARIFF.excess_rate(DAY)
    contract = float(np.percentile(load, 90))
    dp = schedule_day(load, price, contract, BATTERY, weight)
    lp = solve_day_lp(load, price, contract, BATTERY, weight)
    assert dp.cost >= lp - 1e-6                  # the LP is the exact optimum
    assert (dp.cost - lp) / lp < 0.01            # discretization gap under 1%


def test_dp_respects_physics():
    load = daily_load()
    s = schedule_day(load, TARIFF.energy_price(DAY), 750.0, BATTERY, 600.0)
    assert np.all(s.charge_kw <= BATTERY.power_kw + 1e-6) and np.all(s.discharge_kw <= BATTERY.power_kw + 1e-6)
    assert np.all(s.discharge_kw <= load + 1e-6)
    assert s.soc_kwh.min() >= -1e-6 and s.soc_kwh.max() <= BATTERY.capacity_kwh + 1e-6
    assert s.soc_kwh[0] == pytest.approx(s.soc_kwh[-1])
    assert np.all((s.charge_kw == 0) | (s.discharge_kw == 0))


def test_battery_lowers_the_bill_with_perfect_foresight():
    load = daily_load()
    price = TARIFF.energy_price(DAY)
    contract = 800.0
    plan = schedule_day(load, price, contract, BATTERY, 600.0)
    with_battery = monthly_bill(DAY, actual_grid(load, plan.charge_kw, plan.discharge_kw), contract, TARIFF)
    without = monthly_bill(DAY, load, contract, TARIFF)
    assert with_battery["total"].sum() < without["total"].sum()


def test_excess_charge_tiers():
    # 1,000 kW contract, 1,150 kW peak: 100 kW at 2x and 50 kW at 3x the summer basic charge
    assert TARIFF.excess_charge({"peak": 1150}, 1000, "summer") == pytest.approx(200 * (2 * 100 + 3 * 50))
    assert TARIFF.excess_charge({"peak": 900, "off_peak": 950}, 1000, "summer") == 0.0


def test_excess_is_not_billed_twice():
    # Peak exceeds by 50 kW, off-peak by 80 kW: off-peak is billed only for 80 - 50 = 30 kW, at the off-peak rate
    kw = TARIFF.excess_kw({"peak": 1050, "off_peak": 1080}, 1000)
    assert kw == {"peak": 50, "semi_peak": 0, "off_peak": 30}
    assert TARIFF.excess_charge({"peak": 1050, "off_peak": 1080}, 1000, "summer") == pytest.approx(2 * (200 * 50 + 40 * 30))


def test_official_tariff_loads():
    t = load_tariff()
    tuesday = pd.date_range("2014-07-08", periods=96, freq="15min")
    assert t.energy_price(tuesday)[36] == 6.75 and t.energy_price(tuesday)[35] == 2.71   # 09:00 peak, 08:45 off-peak
    december_sunday = pd.date_range("2014-12-14", periods=96, freq="15min")
    assert set(t.period(december_sunday)) == {"off_peak"}
