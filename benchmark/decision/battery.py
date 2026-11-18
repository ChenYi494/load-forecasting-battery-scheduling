import os
from dataclasses import dataclass

import yaml

from benchmark.config import BASE_DIR

BATTERY_PATH = os.path.join(BASE_DIR, "configs", "battery.yaml")


@dataclass
class Battery:
    capacity_kwh: float
    power_kw: float
    round_trip_efficiency: float
    start_soc_fraction: float = 0.5
    cycle_cost_per_kwh: float = 0.0

    @property
    def eta(self) -> float:
        """One-way efficiency; the round trip is split evenly between charging and discharging."""
        return self.round_trip_efficiency ** 0.5

    @property
    def start_kwh(self) -> float:
        return self.capacity_kwh * self.start_soc_fraction


def battery_for_load(mean_load_kw: float, hours: float | None = None, path: str = BATTERY_PATH) -> Battery:
    """Battery sized from configs/battery.yaml relative to the client's mean load."""
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    h = cfg["capacity_hours_of_mean_load"] if hours is None else hours
    return Battery(
        capacity_kwh=h * mean_load_kw,
        power_kw=cfg["power_fraction_of_mean_load"] * mean_load_kw,
        round_trip_efficiency=cfg["round_trip_efficiency"],
        start_soc_fraction=cfg["start_soc_fraction"],
        cycle_cost_per_kwh=cfg["cycle_cost_per_kwh"],
    )
