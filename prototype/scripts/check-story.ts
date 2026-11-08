import assert from 'node:assert/strict';
import { firstMission, nextExercises } from '../src/curriculum';
import { nodes } from '../src/mission';
import { campaignStory, storyDebriefs, storyIntroActions, storyOpening, storyTitle } from '../src/story';
import { missionCatalog, missionIds, nextMission } from '../src/mission-catalog';

const missions = [{ id: 'first-light', title: firstMission.title }, ...nextExercises];
const focuses = new Set(['overview', ...nodes.map((node) => node.id)]);
const nonempty = (value: string, label: string) => {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.trim().length > 0, `${label} must not be empty`);
  assert.equal(value, value.trim(), `${label} must have no outer whitespace`);
};
const compact = (text: string, label: string) => {
  const words = text.trim().split(/\s+/).length;
  assert.ok(words >= 40 && words <= 70, `${label} has ${words} words; expected 40 through 70`);
};

assert.equal(storyOpening.length, 3, 'Opening has three manually advanced story beats');
assert.equal(new Set(storyOpening.map((beat) => beat.id)).size, storyOpening.length, 'Opening IDs are unique');
for (const beat of storyOpening) {
  for (const key of ['id', 'speaker', 'role', 'title', 'text', 'focus'] as const) {
    nonempty(beat[key], `${beat.id}.${key}`);
  }
  assert.ok(focuses.has(beat.focus), `${beat.id} references an existing world focus`);
  compact(beat.text, beat.id);
}

assert.equal(campaignStory.chapters.length, 11, 'Campaign contains eleven contracts');
assert.equal(campaignStory.chapters.length, missions.length, 'Campaign length matches curriculum');
assert.equal(new Set(campaignStory.chapters.map((chapter) => chapter.id)).size, missions.length, 'Chapter IDs are unique');
assert.deepEqual(campaignStory.chapters.map((chapter) => chapter.id), missions.map((mission) => mission.id), 'Chapter order and IDs match curriculum');
assert.deepEqual(campaignStory.chapters.map((chapter) => chapter.title), missions.map((mission) => mission.title), 'Mission names match curriculum');
for (const key of ['title', 'tagline', 'premise', 'playerRole'] as const) {
  nonempty(campaignStory[key], `campaignStory.${key}`);
}
for (const chapter of campaignStory.chapters) {
  for (const key of ['id', 'title', 'logline', 'stakes', 'payoff'] as const) {
    nonempty(chapter[key], `${chapter.id}.${key}`);
  }
  assert(!/planned/i.test(chapter.logline), `${chapter.id} is a current playable contract`);
}

assert.deepEqual(Object.keys(storyDebriefs), missionIds, 'Every playable mission has a success debrief');
const speakers = new Set(storyOpening.map((beat) => beat.speaker));
for (const [id, debrief] of Object.entries(storyDebriefs)) {
  assert.ok(missions.some((mission) => mission.id === id), `${id} references a curriculum mission`);
  for (const key of ['title', 'text', 'speaker', 'nextLabel'] as const) {
    nonempty(debrief[key], `${id}.${key}`);
  }
  assert.ok(speakers.has(debrief.speaker), `${id} uses an introduced speaker`);
  compact(debrief.text, `${id} debrief`);
}
assert.equal(storyDebriefs['first-light'].nextLabel, 'Continue to supply dock');
assert.equal(storyDebriefs['one-crate-one-receipt'].nextLabel, 'Continue to Read the weather');
for (const id of missionIds.slice(1)) {
  const next = nextMission(id);
  assert.equal(storyDebriefs[id].nextLabel, next ? `Continue to ${missionCatalog[next].title}` : 'Return to field map');
}
for (const [key, value] of Object.entries(storyTitle)) nonempty(value, `storyTitle.${key}`);
assert.equal(storyTitle.startLabel, 'Start game');
assert.equal(storyIntroActions.skipLabel, 'Skip intro');
assert.equal(storyIntroActions.finalLabel, 'Read First light brief');
for (const [key, value] of Object.entries(storyIntroActions)) nonempty(value, `storyIntroActions.${key}`);

console.log('Story checks passed. Three compact opening beats, eleven 40–70-word debriefs, eleven current chapters and actual next actions. UI progression and human playtesting remain separate gates.');
