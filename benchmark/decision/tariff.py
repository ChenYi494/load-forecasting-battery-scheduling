"""Time-of-use tariff with a contracted demand and an excess-demand charge (Taipower structure)."""
import os
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
import yaml

from benchmark.config import BASE_DIR

TARIFF_PATH = os.path.join(BASE_DIR, "configs", "tariff.yaml")
SLOT_HOURS = 0.25
PERIODS = ("peak", "semi_peak", "off_peak")


@dataclass
class Tariff:
    name: str
    summer_start: tuple[int, int]
    summer_end: tuple[int, int]
    basic: dict          # season -> TWD per kW per month (經常契約)
    off_peak_basic: dict # season -> TWD per kW per month (週六半尖峰 / 離峰契約)
    energy: dict         # season -> period -> TWD per kWh
    periods: dict        # season -> day type -> list of (from_minute, to_minute, period)
    penalty_within: float
    penalty_beyond: float
    source: dict
    shift: pd.Timedelta = field(default_factory=lambda: pd.Timedelta(0))   # sensitivity: move all period windows later by this much

    def season(self, ts: pd.DatetimeIndex) -> np.ndarray:
        md = ts.month * 100 + ts.day
        start = self.summer_start[0] * 100 + self.summer_start[1]
        end = self.summer_end[0] * 100 + self.summer_end[1]
        return np.where((md >= start) & (md <= end), "summer", "non_summer")

    def period(self, ts: pd.DatetimeIndex) -> np.ndarray:
        ts = ts - self.shift
        season = self.season(ts)
        dow = ts.day_of_week
        day_type = np.where(dow < 5, "weekday", np.where(dow == 5, "saturday", "sunday"))
        minute = ts.hour * 60 + ts.minute
        out = np.full(len(ts), "off_peak", dtype=object)
        for s in ("summer", "non_summer"):
            for d in ("weekday", "saturday", "sunday"):
                for lo, hi, name in self.periods[s][d]:
                    mask = (season == s) & (day_type == d) & (minute >= lo) & (minute < hi)
                    out[mask] = name
        return out

    def energy_price(self, ts: pd.DatetimeIndex) -> np.ndarray:
        season, period = self.season(ts), self.period(ts)
        return np.array([self.energy[s][p] for s, p in zip(season, period)], dtype=float)

    def excess_rate(self, ts: pd.DatetimeIndex) -> np.ndarray:
        """Basic charge that applies to excess demand in each slot: 經常契約 in peak, 週六半尖峰/離峰契約 otherwise."""
        season, period = self.season(ts), self.period(ts)
        return np.array([self.basic[s] if p == "peak" else self.off_peak_basic[s] for s, p in zip(season, period)])

    def excess_kw(self, max_by_period: dict, contract_kw: float) -> dict:
        """Excess kW per period for a contract with only 經常契約 (詳細電價表 p.12, 二段式 a-e).

        Saturday excess deducts the peak excess; off-peak excess deducts the larger of the two,
        so the same kW is never billed twice.
        """
        raw = {p: max(0.0, max_by_period.get(p, 0.0) - contract_kw) for p in PERIODS}
        return {
            "peak": raw["peak"],
            "semi_peak": max(0.0, raw["semi_peak"] - raw["peak"]),
            "off_peak": max(0.0, raw["off_peak"] - max(raw["peak"], raw["semi_peak"])),
        }

    def excess_charge(self, max_by_period: dict, contract_kw: float, season: str) -> float:
        """Monthly excess charge: the first 10% of the contract at 2x, the rest at 3x the applicable basic charge.

        The 10% band is used by the peak excess first, then Saturday, then off-peak (our assumption;
        the tariff does not say how the band is shared between periods).
        """
        band = 0.1 * contract_kw
        total = 0.0
        for period, kw in self.excess_kw(max_by_period, contract_kw).items():
            rate = self.basic[season] if period == "peak" else self.off_peak_basic[season]
            within = min(kw, band)
            band -= within
            total += rate * (self.penalty_within * within + self.penalty_beyond * (kw - within))
        return total


def _minutes(hhmm: str) -> int:
    h, m = hhmm.split(":")
    return int(h) * 60 + int(m)


def _check_filled(node, path="tariff"):
    if node is None:
        raise ValueError(f"{path} is empty: copy it from the official Taipower tariff table into configs/tariff.yaml")
    if isinstance(node, dict):
        for k, v in node.items():
            _check_filled(v, f"{path}.{k}")
    if isinstance(node, list):
        for i, v in enumerate(node):
            _check_filled(v, f"{path}[{i}]")


def tariff_from_dict(cfg: dict) -> Tariff:
    _check_filled(cfg)
    md = lambda s: tuple(int(x) for x in s.split("-"))
    periods = {
        season: {day: [(_minutes(p["from"]), _minutes(p["to"]), p["period"]) for p in spans]
                 for day, spans in days.items()}
        for season, days in cfg["periods"].items()
    }
    for season in periods.values():
        for spans in season.values():
            for _, _, name in spans:
                if name not in PERIODS:
                    raise ValueError(f"unknown period {name}")
    return Tariff(
        name=cfg["name"],
        summer_start=md(cfg["summer"]["start"]),
        summer_end=md(cfg["summer"]["end"]),
        basic=cfg["basic_charge_per_kw_month"],
        off_peak_basic=cfg["off_peak_contract_per_kw_month"],
        energy=cfg["energy_charge_per_kwh"],
        periods=periods,
        penalty_within=float(cfg["excess_penalty"]["within_10pct"]),
        penalty_beyond=float(cfg["excess_penalty"]["beyond_10pct"]),
        source=cfg["source"],
    )


def load_tariff(path: str = TARIFF_PATH) -> Tariff:
    with open(path, encoding="utf-8") as f:
        return tariff_from_dict(yaml.safe_load(f))
