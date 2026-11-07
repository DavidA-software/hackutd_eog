import type { GraphNode, GraphEdge } from '../types';

/**
 * Haversine distance between two lat/lon points in km
 */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface DijkstraResult {
  distances: Record<string, number>;
  previous: Record<string, string | null>;
}

/**
 * Dijkstra's shortest path on a weighted graph.
 * Returns distances and previous-node map for path reconstruction.
 */
export function dijkstra(
  nodes: GraphNode[],
  edges: GraphEdge[],
  sourceId: string
): DijkstraResult {
  const dist: Record<string, number> = {};
  const prev: Record<string, string | null> = {};
  const visited = new Set<string>();

  // Adjacency list
  const adj: Record<string, { to: string; weight: number }[]> = {};
  for (const n of nodes) {
    dist[n.id] = Infinity;
    prev[n.id] = null;
    adj[n.id] = [];
  }
  for (const e of edges) {
    adj[e.from]?.push({ to: e.to, weight: e.weight });
    adj[e.to]?.push({ to: e.from, weight: e.weight }); // undirected
  }

  dist[sourceId] = 0;

  // Simple O(n²) Dijkstra (sufficient for our small graph ~50 nodes)
  const remaining = new Set(nodes.map((n) => n.id));

  while (remaining.size > 0) {
    // Pick node with smallest dist
    let u: string | null = null;
    let minDist = Infinity;
    for (const id of remaining) {
      if (dist[id] < minDist) {
        minDist = dist[id];
        u = id;
      }
    }
    if (u === null || dist[u] === Infinity) break;
    remaining.delete(u);
    visited.add(u);

    for (const { to, weight } of adj[u] ?? []) {
      if (visited.has(to)) continue;
      const alt = dist[u] + weight;
      if (alt < dist[to]) {
        dist[to] = alt;
        prev[to] = u;
      }
    }
  }

  return { distances: dist, previous: prev };
}

/**
 * Reconstruct path from dijkstra result
 */
export function reconstructPath(
  previous: Record<string, string | null>,
  targetId: string
): string[] {
  const path: string[] = [];
  let current: string | null = targetId;
  while (current !== null) {
    path.unshift(current);
    current = previous[current] ?? null;
  }
  return path;
}

/**
 * Build graph nodes and edges from loaded network data.
 */
import type { NetworkData, TelemetryIndex } from '../types';
import { latestValue } from '../data/loader';

export function buildNetworkGraph(
  network: NetworkData,
  telemetry: TelemetryIndex,
  now_unix: number
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const system of network.systems) {
    // Truck yard node
    nodes.push({
      id: `${system.id}_YARD`,
      lat: system.truck_yard[0],
      lon: system.truck_yard[1],
      type: 'truck_yard',
      system_id: system.id,
    });
    // Disposal site node
    nodes.push({
      id: system.disposal_site.id,
      lat: system.disposal_site.lat,
      lon: system.disposal_site.lon,
      type: 'disposal',
      system_id: system.id,
    });

    for (const facility of system.facilities) {
      // Facility node (represents tank location)
      nodes.push({
        id: facility.id,
        lat: facility.lat,
        lon: facility.lon,
        type: 'facility',
        system_id: system.id,
      });

      // Edge: facility → disposal (pipeline)
      const flow = latestValue(telemetry, facility.pipeline.id, 'receive_flow_bpd', now_unix) ?? 0;
      const pressure = latestValue(telemetry, facility.pipeline.id, 'pressure_psi', now_unix) ?? 0;
      const dist = haversine(
        facility.lat,
        facility.lon,
        system.disposal_site.lat,
        system.disposal_site.lon
      );
      edges.push({
        from: facility.id,
        to: system.disposal_site.id,
        weight: dist,
        pipeline_id: facility.pipeline.id,
        flow_bpd: flow,
        pressure_psi: pressure,
      });

      // Edge: truck_yard → facility (truck route)
      const truckDist = haversine(
        system.truck_yard[0],
        system.truck_yard[1],
        facility.lat,
        facility.lon
      );
      edges.push({
        from: `${system.id}_YARD`,
        to: facility.id,
        weight: truckDist,
      });
    }
  }

  return { nodes, edges };
}

/**
 * Get the best (shortest) truck route: yard → target_facility → disposal
 */
export function bestTruckRoute(
  nodes: GraphNode[],
  edges: GraphEdge[],
  system_id: string,
  facility_id: string
): { path: string[]; distance_km: number } {
  const yardId = `${system_id}_YARD`;
  const result = dijkstra(nodes, edges, yardId);
  const path = reconstructPath(result.previous, facility_id);
  return {
    path,
    distance_km: result.distances[facility_id],
  };
}
