import type {
  Facility,
  FacilityOps,
  SystemOps,
  OpsData,
  RecommendedAction,
  TruckPlan,
  ShutInPlan,
  DoNothingPlan,
  Plan,
} from '../types';

/**
 * Compute the cheapest response plan for a pump failure.
 * Returns all plans sorted by cost, cheapest first.
 */
export function computeRecommendedAction(
  facility: Facility,
  facilityOps: FacilityOps | undefined,
  systemOps: SystemOps | undefined,
  ops: OpsData,
  level_pct: number,
  hours_to_limit: number | null,
  repair_hours: number,
  now_unix: number,
  lost_rev_per_hour: number
): RecommendedAction {
  const plans: Plan[] = [];

  const capacity_bbl = facility.tank.capacity_bbl;
  const shutdown_pct = 92;
  const current_bbl = (level_pct / 100) * capacity_bbl;
  const limit_bbl = (shutdown_pct / 100) * capacity_bbl;
  const inflow_bpd = facility.wells.reduce((s, w) => s + w.baseline_water_bpd, 0);
  const inflow_bph = inflow_bpd / 24;

  // Total inflow during repair window (hours)
  const total_fill_bbl = inflow_bph * repair_hours;
  const peak_bbl = current_bbl + total_fill_bbl;
  const peak_pct = (peak_bbl / capacity_bbl) * 100;

  // ── Do Nothing ────────────────────────────────────────────────────────────
  let do_nothing_cost = 0;
  let downtime_hours = 0;
  let trips_at_unix: number | null = null;

  if (peak_pct >= shutdown_pct && hours_to_limit !== null) {
    // Facility will trip before repair completes
    trips_at_unix = now_unix + hours_to_limit * 3600;
    const shutdown_at_hour = hours_to_limit;
    downtime_hours = Math.max(0, repair_hours - shutdown_at_hour);
    do_nothing_cost = downtime_hours * lost_rev_per_hour;
  } else {
    // Tank peaks below shutdown — no cost
    downtime_hours = 0;
    do_nothing_cost = 0;
  }

  const doNothingPlan: DoNothingPlan = {
    type: 'do_nothing',
    trips_at_unix,
    downtime_hours,
    total_cost: Math.round(do_nothing_cost),
    description:
      peak_pct < shutdown_pct
        ? `Tank peaks at ~${peak_pct.toFixed(1)}%, never trips. No action needed.`
        : `Tank trips at ~${hours_to_limit?.toFixed(1)}h, wells dark for ~${downtime_hours.toFixed(1)}h.`,
  };
  plans.push(doNothingPlan);

  // ── Truck Plan ─────────────────────────────────────────────────────────────
  if (facilityOps && systemOps) {
    const fleet = systemOps.emergency_fleet_size;
    const truck_cap = ops.emergency_trucking.truck_capacity_bbl;
    const cost_per_trip = ops.emergency_trucking.cost_per_trip;
    const response_min = facilityOps.response_min;

    if (fleet > 0 && hours_to_limit !== null) {
      // How many barrels need to be removed to keep tank under shutdown?
      const overflow_bbl = Math.max(0, peak_bbl - limit_bbl + 20); // 20 bbl buffer
      const trips_needed = Math.ceil(overflow_bbl / truck_cap);
      const trucks_to_dispatch = Math.min(fleet, trips_needed);
      const cost = trips_needed * cost_per_trip;

      const truckPlan: TruckPlan = {
        type: 'truck',
        truck_count: trucks_to_dispatch,
        trip_count: trips_needed,
        total_cost: cost,
        dispatch_time_min: response_min,
        trucks_available: fleet,
      };
      plans.push(truckPlan);
    }
  }

  // ── Shut-In Plan ───────────────────────────────────────────────────────────
  if (hours_to_limit !== null && hours_to_limit > 0) {
    // Find cheapest well to shut in (lowest revenue/hour)
    const wellRevenues = facility.wells.map((w) => ({
      well: w,
      rev_per_hour:
        (w.oil_bpd / 24) * ops.prices.oil_per_bbl +
        (w.gas_mcfd / 24) * ops.prices.gas_per_mcf,
      water_bph: w.baseline_water_bpd / 24,
    }));
    wellRevenues.sort((a, b) => a.rev_per_hour - b.rev_per_hour);

    // Simulate shutting in wells until tank no longer trips
    let shutInWells: typeof wellRevenues = [];
    let reducedInflowBph = inflow_bph;
    let totalShutInCost = 0;

    for (const wr of wellRevenues) {
      reducedInflowBph -= wr.water_bph;
      shutInWells.push(wr);

      // When do we need to shut in to prevent the trip?
      // We want: current_bbl + reducedInflowBph * repair_hours <= limit_bbl
      const newPeak = current_bbl + reducedInflowBph * repair_hours;
      if (newPeak < limit_bbl * 0.97) {
        // When to shut in: solve current_bbl + inflow_bph * t + reducedInflowBph * (repair_hours - t) <= limit_bbl
        // simplified: shut in immediately to be safe, compute cost as (repair_hours) * rev_per_hour for each shut-in well
        const shutInHours = repair_hours;
        totalShutInCost = shutInWells.reduce(
          (sum, w) => sum + w.rev_per_hour * shutInHours,
          0
        );

        const plan: ShutInPlan = {
          type: 'shut_in',
          well_id: shutInWells[0].well.id,
          shut_in_at_min: 0,
          shut_in_hours: shutInHours,
          total_cost: Math.round(totalShutInCost),
          description: `Shut in ${shutInWells.map((w) => w.well.id).join(', ')} for ~${shutInHours.toFixed(1)}h. Tank stays under ${(newPeak / capacity_bbl * 100).toFixed(1)}%.`,
        };
        plans.push(plan);
        break;
      }
    }
  }

  // Sort by cost
  plans.sort((a, b) => a.total_cost - b.total_cost);
  const cheapest = plans[0];
  const cost_of_nothing = doNothingPlan.total_cost;
  const savings = Math.max(0, cost_of_nothing - cheapest.total_cost);

  return { cheapest, all_plans: plans, cost_of_doing_nothing: cost_of_nothing, savings };
}
