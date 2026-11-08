import { mission as weather } from './missions/read-the-weather';
import { mission as stock } from './missions/balance-the-store';
import { mission as power } from './missions/share-the-battery';
import { mission as workshop } from './missions/open-the-workshop';
import { mission as sensors } from './missions/steady-the-sensors';
import { mission as seedlings } from './missions/raise-the-seedlings';
import { mission as radio } from './missions/give-the-radio-a-rest';
import { mission as airlock } from './missions/keep-the-airlock-clear';
import { mission as beacon } from './missions/agree-on-the-beacon';
import { firstMission } from './curriculum';
import { starter, solution, hints } from './mission';
import { deliveryMission } from './delivery-mission';
import type { ProgramMissionId } from './mission-catalog';
import type { ProgramDefinition } from './program-mission-types';

type MissionRegistry = {
  'first-light': { id: 'first-light'; brief: typeof firstMission; starter: string; solution: string; hints: string[] };
  'one-crate-one-receipt': typeof deliveryMission & { id: 'one-crate-one-receipt' };
} & { [M in ProgramMissionId]: ProgramDefinition<M> };

export const missions: MissionRegistry = {
  'first-light': { id: 'first-light', brief: firstMission, starter, solution, hints },
  'one-crate-one-receipt': { ...deliveryMission, id: 'one-crate-one-receipt' },
  'read-the-weather': weather,
  'balance-the-store': stock,
  'share-the-battery': power,
  'open-the-workshop': workshop,
  'steady-the-sensors': sensors,
  'raise-the-seedlings': seedlings,
  'give-the-radio-a-rest': radio,
  'keep-the-airlock-clear': airlock,
  'agree-on-the-beacon': beacon,
} as const;
