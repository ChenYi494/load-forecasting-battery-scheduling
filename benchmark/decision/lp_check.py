"""Exact optimum of the same daily problem as a linear program (SciPy HiGHS), to verify the DP."""
import numpy as np
from scipy.optimize import linprog

from benchmark.decision.battery import Battery
from benchmark.decision.tariff import SLOT_HOURS


def solve_day_lp(load_kw, price, contract_kw, battery: Battery, overload_weight) -> float:
    """Minimum planning cost; variables per slot: charge c, discharge d, overload x, end-of-slot charge s."""
    load_kw = np.asarray(load_kw, dtype=float)
    n = len(load_kw)
    weight = np.broadcast_to(np.asarray(overload_weight, dtype=float), (n,))
    ic, id_, ix, is_ = 0, n, 2 * n, 3 * n                       # offsets of c, d, x, s
    nv = 4 * n
    cost = np.zeros(nv)
    cost[ic:ic + n] = price * SLOT_HOURS
    cost[id_:id_ + n] = -price * SLOT_HOURS + battery.cycle_cost_per_kwh * SLOT_HOURS
    cost[ix:ix + n] = weight

    # State of charge: s_t = s_{t-1} + h*eta*c_t - h*d_t/eta, with s_{-1} = start and s_{n-1} = start
    a_eq = np.zeros((n + 1, nv))
    b_eq = np.zeros(n + 1)
    for t in range(n):
        a_eq[t, is_ + t] = 1.0
        if t > 0:
            a_eq[t, is_ + t - 1] = -1.0
        a_eq[t, ic + t] = -SLOT_HOURS * battery.eta
        a_eq[t, id_ + t] = SLOT_HOURS / battery.eta
        b_eq[t] = battery.start_kwh if t == 0 else 0.0
    a_eq[n, is_ + n - 1] = 1.0
    b_eq[n] = battery.start_kwh

    # Overload: load + c - d - x <= contract
    rows = [t for t in range(n) if weight[t] > 0]
    a_ub = np.zeros((len(rows), nv))
    b_ub = np.zeros(len(rows))
    for k, t in enumerate(rows):
        a_ub[k, ic + t], a_ub[k, id_ + t], a_ub[k, ix + t] = 1.0, -1.0, -1.0
        b_ub[k] = contract_kw - load_kw[t]

    bounds = ([(0, battery.power_kw)] * n
              + [(0, min(battery.power_kw, max(l, 0.0))) for l in load_kw]   # no export
              + [(0, None)] * n
              + [(0, battery.capacity_kwh)] * n)
    res = linprog(cost, A_ub=a_ub if rows else None, b_ub=b_ub if rows else None,
                  A_eq=a_eq, b_eq=b_eq, bounds=bounds, method="highs")
    if not res.success:
        raise RuntimeError(res.message)
    return float(res.fun + np.sum(price * load_kw * SLOT_HOURS))
