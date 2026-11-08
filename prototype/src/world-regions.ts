import { missionCatalog, missionIds, previousMission, type MissionId } from './mission-catalog';

export type WorldMissionContext = Readonly<{ activeMission: MissionId; completed: readonly MissionId[] }>;
export type WorldMissionRegion = Readonly<{
  mission: MissionId; nodeId: string;
  availability: 'locked' | 'available' | 'complete'; active: boolean;
}>;

function missionView(activeMission: MissionId, count: number) {
  const regions = Object.freeze(missionIds.map((mission, index): WorldMissionRegion => Object.freeze({
    mission, nodeId: missionCatalog[mission].focus, active: mission === activeMission,
    availability: index < count ? 'complete' : index === count ? 'available' : 'locked',
  })));
  const nextLocked = regions.find((region) => region.availability === 'locked') ?? null;
  const prerequisite = nextLocked ? previousMission(nextLocked.mission) : null;
  const lockLabel = nextLocked && prerequisite
    ? `${missionCatalog[nextLocked.mission].title} locked. Complete ${missionCatalog[prerequisite].title}.`
    : count === missionIds.length ? 'All missions complete' : 'No locked missions';
  const clusters = Object.freeze([...new Set(missionIds.map((id) => missionCatalog[id].focus))].map((nodeId) => {
    const missions = Object.freeze(regions.filter((region) => region.nodeId === nodeId));
    return Object.freeze({ nodeId, missions, description: missions.map((region) => `${missionCatalog[region.mission].title}. ${region.availability}${region.active ? '. Active problem' : ''}.`).join(' ') });
  }));
  const metadata = missionCatalog[activeMission];
  return Object.freeze({
    activeMission, target: metadata.focus, problem: metadata.problem, regions, clusters,
    completedCount: count, nextLocked, lockLabel, serialized: JSON.stringify(regions),
    supplyLabel: `Supply mission ${regions[1].availability}`, activeLabel: `Active · ${metadata.problem}`,
    description: `Active problem: ${metadata.problem}. ${count} / ${missionIds.length} complete. ${lockLabel} All six stations and working graph corridors remain available. ${clusters.map((cluster) => `${cluster.nodeId}. ${cluster.description}`).join(' ')} Unbuilt territory offshore. No missions here.`,
  });
}

const views = new Map<MissionId, readonly ReturnType<typeof missionView>[]>(
  missionIds.map((activeMission) => [activeMission, Object.freeze(Array.from({ length: missionIds.length + 1 }, (_, count) => missionView(activeMission, count)))]),
);

export function worldMissionView(context: WorldMissionContext) {
  let count = 0;
  while (count < missionIds.length && context.completed.includes(missionIds[count])) count++;
  return views.get(context.activeMission)![count];
}
