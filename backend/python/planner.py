"""
Cheapest response to a pump failure (SPEC.md "Plans").

Options, alone or mixed:
  - Trucks: all called at plan start, arrive together `response_min` later, then one more
    trip each every `cycle_min`. Each trip removes up to `truck_capacity_bbl` and costs
    `cost_per_trip`. A trip only helps if it arrives before the tank trips and before the
    repair ends.
  - Shut in wells: instant, can start late, lasts until the repair ends. Costs the oil and
    gas those wells would have sold. We always pick the latest start that still works.
  - Do nothing: the tank trips and every well at the facility is dark until the repair.

A plan other than "do nothing" must keep the tank below shutdown for the whole repair.
"""
from dataclasses import dataclass, field
from itertools import combinations, product

EPS = 1e-6


@dataclass
class Well:
    id: str
    water_bph: float          # barrels of water per hour this well adds to the tank
    rev_per_hour: float       # oil + gas revenue per hour


@dataclass
class Situation:
    """A failing pump's tank at plan start."""
    facility: str
    volume_bbl: float         # water in the tank now
    capacity_bbl: float
    shutdown_bbl: float
    wells: list[Well]
    horizon_h: float          # repair time remaining
    response_min: float
    cycle_min: float
    truck_bbl: float
    trip_cost: float
    tripped: bool = False     # already shut in automatically

    @property
    def inflow_bph(self):
        return sum(w.water_bph for w in self.wells)

    @property
    def rev_per_hour(self):
        return sum(w.rev_per_hour for w in self.wells)


@dataclass
class Plan:
    trucks: int = 0
    trips_per_truck: int = 0
    shut_in: tuple = ()               # well ids
    shut_in_at_min: float = 0.0
    truck_cost: float = 0.0
    shut_in_cost: float = 0.0
    do_nothing: bool = False
    trip_h: float | None = None       # for do-nothing: hours until the tank trips (None = never)
    downtime_h: float = 0.0
    peak_pct: float = 0.0
    arrivals_min: list = field(default_factory=list)

    @property
    def cost(self):
        return self.truck_cost + self.shut_in_cost


def simulate(s: Situation, trucks: int, trips: int, shut: tuple, shut_at_min: float):
    """Return (survives, peak_bbl). Survives = tank never reaches shutdown before the repair ends."""
    horizon_min = s.horizon_h * 60
    q_all = s.inflow_bph / 60
    q_after = (s.inflow_bph - sum(w.water_bph for w in s.wells if w.id in shut)) / 60 if shut else q_all
    shut_at = min(shut_at_min, horizon_min) if shut else horizon_min

    def volume_at(t_min, removed):
        filled = q_all * min(t_min, shut_at) + q_after * max(0.0, t_min - shut_at)
        return s.volume_bbl + filled - removed

    removed, peak = 0.0, s.volume_bbl
    for j in range(trips if trucks else 0):
        arrive = s.response_min + j * s.cycle_min
        if arrive >= horizon_min:
            return False, peak               # every trip must arrive before the repair ends
        before = volume_at(arrive, removed)
        peak = max(peak, before)
        if before >= s.shutdown_bbl - EPS:
            return False, peak               # arrived after the tank tripped
        removed += min(trucks * s.truck_bbl, before)
    end = volume_at(horizon_min, removed)
    peak = max(peak, end)
    return end < s.shutdown_bbl - EPS, peak


def do_nothing(s: Situation) -> Plan:
    if s.tripped:
        return Plan(do_nothing=True, trip_h=0.0, downtime_h=s.horizon_h,
                    shut_in_cost=s.rev_per_hour * s.horizon_h, peak_pct=100 * s.shutdown_bbl / s.capacity_bbl)
    q = s.inflow_bph
    trip_h = (s.shutdown_bbl - s.volume_bbl) / q if q > 0 else None
    if trip_h is None or trip_h >= s.horizon_h:
        peak = s.volume_bbl + q * s.horizon_h
        return Plan(do_nothing=True, trip_h=None, peak_pct=100 * peak / s.capacity_bbl)
    downtime = s.horizon_h - max(trip_h, 0.0)
    return Plan(do_nothing=True, trip_h=max(trip_h, 0.0), downtime_h=downtime,
                shut_in_cost=s.rev_per_hour * downtime, peak_pct=100 * s.shutdown_bbl / s.capacity_bbl)


def latest_shut_in(s: Situation, trucks: int, trips: int, shut: tuple):
    """Latest whole minute to start shutting in `shut` that still keeps the tank safe (None if impossible)."""
    if not simulate(s, trucks, trips, shut, 0.0)[0]:
        return None
    lo, hi = 0, int(s.horizon_h * 60)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if simulate(s, trucks, trips, shut, mid)[0]:
            lo = mid
        else:
            hi = mid - 1
    return lo


def best_plans(s: Situation, max_trucks: int) -> dict:
    """Cheapest plan of each kind using at most `max_trucks` trucks."""
    nothing = do_nothing(s)
    out = {"do_nothing": nothing, "truck": None, "shut_in": None, "combo": None}
    if s.tripped or nothing.trip_h is None:
        return out

    max_trips = max(0, int((s.horizon_h * 60 - s.response_min - EPS) // s.cycle_min) + 1)
    subsets = [()] + [c for n in range(1, len(s.wells) + 1) for c in combinations([w.id for w in s.wells], n)]
    rev = {w.id: w.rev_per_hour for w in s.wells}

    truck_options = [(0, 0)] + [(k, m) for k, m in product(range(1, max_trucks + 1), range(1, max_trips + 1))]
    for k, m in truck_options:
        truck_cost = k * m * s.trip_cost
        for shut in subsets:
            if not k and not shut:
                continue
            if shut:
                at = latest_shut_in(s, k, m, shut)
                if at is None:
                    continue
            else:
                if not simulate(s, k, m, (), 0.0)[0]:
                    continue
                at = 0
            shut_cost = sum(rev[w] for w in shut) * (s.horizon_h - at / 60) if shut else 0.0
            ok, peak = simulate(s, k, m, shut, at)
            plan = Plan(trucks=k, trips_per_truck=m, shut_in=shut, shut_in_at_min=at,
                        truck_cost=truck_cost, shut_in_cost=shut_cost, peak_pct=100 * peak / s.capacity_bbl,
                        arrivals_min=[s.response_min + j * s.cycle_min for j in range(m)] if k else [])
            kind = "combo" if k and shut else ("truck" if k else "shut_in")
            cur = out[kind]
            if cur is None or (plan.cost, plan.trucks * plan.trips_per_truck, len(shut)) < \
                    (cur.cost, cur.trucks * cur.trips_per_truck, len(cur.shut_in)):
                out[kind] = plan
    return out


def cheapest(plans: dict) -> Plan:
    options = [p for p in plans.values() if p is not None]
    return min(options, key=lambda p: (p.cost, p.trucks * p.trips_per_truck, len(p.shut_in), not p.do_nothing))


def plan_system(situations: list[Situation], fleet: int) -> list[tuple[Plan, dict]]:
    """Plan several failing tanks in one system together: they share the truck fleet."""
    per_event = []
    for s in situations:
        by_k = [best_plans(s, k) for k in range(fleet + 1)]
        per_event.append(by_k)

    best_total, best_alloc = None, None
    for alloc in product(range(fleet + 1), repeat=len(situations)):
        if sum(alloc) > fleet:
            continue
        chosen = [cheapest(per_event[i][k]) for i, k in enumerate(alloc)]
        total = sum(p.cost for p in chosen)
        used = sum(p.trucks for p in chosen)
        if best_total is None or (total, used) < best_total:
            best_total, best_alloc = (total, used), alloc
    return [(cheapest(per_event[i][k]), per_event[i][k]) for i, k in enumerate(best_alloc)]
