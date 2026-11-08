import { missionIds, missionCatalog, previousMission, type MissionId } from './mission-catalog';
export { missionIds, missionIds as playableMissions, type MissionId } from './mission-catalog';
export type CampaignProgress = {
  version: 2;
  introSeen: boolean;
  currentMission: MissionId;
  completed: MissionId[];
};

export const campaignStorageKey = 'aster-campaign-v1';
export const sourceStorageKeys = Object.fromEntries(missionIds.map((id) => [id, `aster-${id}-ts-v1`])) as Record<MissionId, string>;
Object.assign(sourceStorageKeys, {
  'first-light': 'aster-route-ts-v1',
  'one-crate-one-receipt': 'aster-intake-ts-v1',
});

export function freshCampaign(): CampaignProgress {
  return { version: 2, introSeen: false, currentMission: 'first-light', completed: [] };
}

export function isUnlocked(progress: CampaignProgress, mission: MissionId): boolean {
  const previous = previousMission(mission);
  return previous === null || progress.completed.includes(previous);
}

export function readCampaign(serialized: string | null): CampaignProgress {
  const initial = freshCampaign();
  if (!serialized || serialized.length > 4096) return initial;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return initial;
    const data = value as Record<string, unknown>;
    if (data.version !== 1 && data.version !== 2) return initial;
    initial.introSeen = data.introSeen === true;
    if (Array.isArray(data.completed)) {
      const eligible = data.version === 1 ? missionIds.slice(0, 2) : missionIds;
      for (const id of eligible) {
        if (!data.completed.includes(id)) break;
        initial.completed.push(id);
      }
    }
    const current = missionIds.find((id) => id === data.currentMission);
    if (current && (data.version === 2 || missionIds.indexOf(current) < 2) && isUnlocked(initial, current)) {
      initial.currentMission = current;
    }
    return initial;
  } catch {
    return initial;
  }
}

export function completeMission(progress: CampaignProgress, mission: MissionId): CampaignProgress {
  const previous = previousMission(mission);
  if (!isUnlocked(progress, mission)) throw new Error(`Complete ${previous ? missionCatalog[previous].title : 'the previous mission'} before opening ${missionCatalog[mission].title}.`);
  if (progress.completed.includes(mission)) return progress;
  if (progress.completed.length !== missionIds.indexOf(mission) || progress.completed.some((id, index) => id !== missionIds[index])) {
    throw new Error('Completion requires a contiguous earned campaign prefix.');
  }
  return {
    ...progress,
    currentMission: mission,
    completed: [...progress.completed, mission],
  };
}
