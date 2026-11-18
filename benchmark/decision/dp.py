"""Day-ahead battery schedule by dynamic programming over a discretized state of charge.

Each 15-minute slot the battery moves between charge levels; the cost of a move is the energy bill
for the resulting grid draw, the cycling cost, and a per-slot weight on any draw above the contracted
capacity (exceeding it triggers the monthly excess-demand charge, at a higher rate in peak periods).

The charge grid is sized from the battery power, not its capacity, so every battery size gets the same
power resolution (power_kw / power_steps per slot); only moves within the power limit are searched.
"""
from dataclasses import dataclass
from fractions import Fraction

import numpy as np

from benchmark.decision.battery import Battery
from benchmark.decision.tariff import SLOT_HOURS

EPS = 1e-9


@dataclass
class Schedule:
    charge_kw: np.ndarray      # grid-side charging power per slot (>= 0)
    discharge_kw: np.ndarray   # power delivered to the load per slot (>= 0)
    soc_kwh: np.ndarray        # state of charge at the start of each slot, plus the end (97 values)
    grid_kw: np.ndarray        # planned draw from the grid for the load used to plan
    cost: float                # planning objective (energy + cycling + overload weight)


def schedule_day(load_kw, price, contract_kw, battery: Battery, overload_weight, power_steps=20):
    """overload_weight: TWD per kW above the contract, per slot (scalar or array of 96)."""
    load_kw = np.asarray(load_kw, dtype=float)
    n = len(load_kw)
    weight = np.broadcast_to(np.asarray(overload_weight, dtype=float), (n,))
    levels = battery.capacity_kwh / (battery.power_kw * SLOT_HOURS * battery.eta / power_steps)
    # Round so the starting charge falls exactly on a level (otherwise the day gets a different usable range)
    q = Fraction(battery.start_soc_fraction).limit_denominator(100).denominator
    levels = max(q, int(np.ceil(levels / q)) * q)
    step = battery.capacity_kwh / levels
    soc = np.arange(levels + 1) * step

    # Level moves k reachable within the power limit, and the power each one needs
    k_max = int(np.floor(battery.power_kw * SLOT_HOURS * max(battery.eta, 1 / battery.eta) / step)) + 1
    moves = np.arange(-k_max, k_max + 1)
    d_e = moves * step
    charge = np.where(d_e > 0, d_e / battery.eta / SLOT_HOURS, 0.0)
    discharge = np.where(d_e < 0, -d_e * battery.eta / SLOT_HOURS, 0.0)
    ok = (charge <= battery.power_kw + EPS) & (discharge <= battery.power_kw + EPS)
    moves, charge, discharge = moves[ok], charge[ok], discharge[ok]

    start = int(round(battery.start_soc_fraction * levels))
    value = np.full(levels + 1, np.inf)
    value[start] = 0.0                                           # end the day where it started
    policy = np.zeros((n, levels + 1), dtype=int)
    states = np.arange(levels + 1)
    for t in range(n - 1, -1, -1):
        grid = load_kw[t] + charge - discharge
        cost = (price[t] * grid * SLOT_HOURS + battery.cycle_cost_per_kwh * discharge * SLOT_HOURS
                + weight[t] * np.maximum(0.0, grid - contract_kw))
        cost = np.where(discharge <= load_kw[t] + EPS, cost, np.inf)  # no export to the grid
        best = np.full(levels + 1, np.inf)
        choice = np.zeros(levels + 1, dtype=int)
        for k, c in zip(moves, cost):
            target = states + k
            valid = (target >= 0) & (target <= levels)
            candidate = np.full(levels + 1, np.inf)
            candidate[valid] = c + value[target[valid]]
            better = candidate < best
            best[better] = candidate[better]
            choice[better] = target[better]
        policy[t] = choice
        value = best

    path = np.empty(n + 1, dtype=int)
    path[0] = start
    for t in range(n):
        path[t + 1] = policy[t, path[t]]
    d_e = np.diff(soc[path])
    c = np.where(d_e > 0, d_e / battery.eta / SLOT_HOURS, 0.0)
    d = np.where(d_e < 0, -d_e * battery.eta / SLOT_HOURS, 0.0)
    return Schedule(charge_kw=c, discharge_kw=d, soc_kwh=soc[path], grid_kw=load_kw + c - d, cost=float(value[start]))
