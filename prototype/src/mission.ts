export type Graph = Record<string, string[]>;
export type MissionNode = { id: string; label: string; position: [number, number]; detail: string };
export type RouteValidation =
  | { ok: true; prefix: string[]; error: null }
  | { ok: false; prefix: string[]; error: string };

export const nodes: MissionNode[] = [
  { id: 'dock', label: 'Landing dock', position: [-8, 4], detail: 'The departure point for Pip and the replacement power cell.' },
  { id: 'relay', label: 'Relay station', position: [-7, -3], detail: 'The old shortcut to the greenhouse is broken. Take the long way around.' },
  { id: 'junction', label: 'The junction', position: [-1, 4], detail: 'Two working corridors branch toward the far side of the settlement.' },
  { id: 'observatory', label: 'Observatory', position: [2, 8], detail: 'A quiet detour. The telescope still follows the sun.' },
  { id: 'garden', label: 'Garden deck', position: [4, 1], detail: 'The last working corridor leads from here to the greenhouse.' },
  { id: 'greenhouse', label: 'Greenhouse', position: [8, -5], detail: 'Waiting for a power cell. There are still seeds inside.' },
];

export const edges: [string, string][] = [
  ['dock', 'relay'],
  ['relay', 'junction'],
  ['junction', 'observatory'],
  ['junction', 'garden'],
  ['observatory', 'garden'],
  ['garden', 'greenhouse'],
];

export const blockedEdge: [string, string] = ['relay', 'greenhouse'];

export const graph: Graph = Object.fromEntries(nodes.map(({ id }) => [
  id,
  edges.filter((edge) => edge.includes(id)).map(([a, b]) => a === id ? b : a),
]));

export const starter = `// Pip's navigation module. Called once per flight.
type Graph = Record<string, string[]>;

/** Return a path that includes start and goal.
 * Return [] if the destination is unreachable.
 */
function route(
  graph: Graph, start: string, goal: string,
): string[] {
  // TODO: find a route through working corridors.
  // Replace the fallback below with your code.
  return [start, goal];
}
`;

export const solution = `// Pip's navigation module. Called once per flight.
type Graph = Record<string, string[]>;

/** Search working corridors without revisiting nodes. */
function route(
  graph: Graph,
  start: string,
  goal: string,
): string[] {
  // Keep candidate routes, not just destination IDs.
  const queue: string[][] = [[start]];
  const visited = new Set([start]);

  while (queue.length > 0) {
    const path = queue.shift()!;
    const current = path[path.length - 1];

    if (current === goal) return path;

    // Each neighbor is a corridor Pip can traverse.
    for (const next of graph[current] ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push([...path, next]);
      }
    }
  }

  return [];
}
`;

export const hints = [
  'The shortcut is gone, but the greenhouse is still connected. Inspect the actual input in the brief to see the working corridors.',
  'Try exploring neighbors from the dock. Remember which locations you have already visited, so cycles do not trap you.',
  'Keep a queue of paths. Remove one path, check its last location, then add paths to each unvisited neighbor. Return when you reach the goal.',
];

export type NavigationCheck = {
  id: string;
  title: string;
  detail: string;
  network: Graph;
  expectsRoute: boolean;
};

function withoutCorridor(a: string, b: string): Graph {
  return Object.fromEntries(Object.entries(graph).map(([id, neighbors]) => [
    id, neighbors.filter((next) => !((id === a && next === b) || (id === b && next === a))),
  ]));
}

export const navigationChecks: NavigationCheck[] = [
  { id: 'delivery', title: 'Deliver the power cell', detail: 'Find a route from dock to greenhouse using the current network.', network: graph, expectsRoute: true },
  { id: 'detour', title: 'Handle a closed corridor', detail: 'The junction–garden corridor is also closed. A route through the observatory still exists.', network: withoutCorridor('junction', 'garden'), expectsRoute: true },
  { id: 'unreachable', title: 'Report an unreachable destination', detail: 'The garden–greenhouse corridor is closed. The greenhouse is isolated. Return [].', network: withoutCorridor('garden', 'greenhouse'), expectsRoute: false },
];

export function checkNavigation(check: NavigationCheck, route: string[]): { ok: boolean; error: string | null } {
  if (!check.expectsRoute) {
    return route.length === 0
      ? { ok: true, error: null }
      : { ok: false, error: 'The greenhouse is isolated in this check. Return [] when there is no route.' };
  }
  const result = validateRoute(route, check.network);
  return { ok: result.ok, error: result.error };
}

export function validateRoute(route: unknown, network: Graph = graph, start = 'dock', goal = 'greenhouse'): RouteValidation {
  const prefix: string[] = [];
  if (!Array.isArray(route)) return { ok: false, prefix, error: 'Return an array of location IDs.' };
  if (route.length === 0) return { ok: false, prefix, error: 'Pip has no route. The greenhouse is reachable in this network.' };
  if (route.length > 100) return { ok: false, prefix, error: 'The route exceeds 100 locations. Check for a cycle.' };
  if (route[0] !== start) return { ok: false, prefix, error: `The route must start at ${start}, where Pip is waiting.` };

  for (let i = 0; i < route.length; i++) {
    const current = route[i];
    if (typeof current !== 'string' || !Object.hasOwn(network, current)) {
      return { ok: false, prefix, error: `Unknown location at step ${i + 1}. Use the station IDs in the mission brief.` };
    }
    if (i > 0 && !network[route[i - 1]].includes(current)) {
      const previous = route[i - 1];
      const broken = blockedEdge.includes(previous) && blockedEdge.includes(current) && previous !== current;
      return { ok: false, prefix, error: broken
        ? `The corridor from ${previous} to ${current} is broken. Pip stopped at ${previous}.`
        : `No working corridor connects ${previous} to ${current}. Pip stopped at ${previous}.` };
    }
    prefix.push(current);
  }

  if (route.at(-1) !== goal) return { ok: false, prefix, error: `Pip reached ${route.at(-1)}, but the power cell needs to reach ${goal}.` };
  return { ok: true, prefix, error: null };
}
