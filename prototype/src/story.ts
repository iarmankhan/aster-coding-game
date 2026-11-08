import { missionCatalog, nextMission, type MissionId } from './mission-catalog';

export type StoryBeat = {
  id: string;
  speaker: string;
  role: string;
  title: string;
  text: string;
  focus: 'dock' | 'relay' | 'junction' | 'observatory' | 'garden' | 'greenhouse' | 'overview';
};

export const storyTitle = {
  title: 'Aster',
  subtitle: 'The next crossing',
  description: 'Return to an island field station. Repair its services through code you write yourself.',
  startLabel: 'Start game',
};

export const storyIntroActions = {
  nextLabel: 'Continue',
  finalLabel: 'Read First light brief',
  skipLabel: 'Skip intro',
};

export const storyOpening: StoryBeat[] = [
  {
    id: 'maintenance-berth',
    speaker: 'Neri',
    role: 'Ferry pilot',
    title: 'The maintenance berth',
    text: "Welcome back to Aster. You booked a maintenance berth instead of a holiday. Years overseeing other people's builds, and you pick the week with a broken footbridge. The field station is above the tide line; the ferry landing isn't. I've left your tool case by the steps. I've penciled the unloading window on my tide table. The next crossing needs an honest manifest.",
    focus: 'dock',
  },
  {
    id: 'bench-by-the-window',
    speaker: 'Mara',
    role: 'Greenhouse keeper',
    title: 'Your bench is still here',
    text: "I kept the bench by the window clear. You said you missed finishing something you could walk over and look at. Here's something. The greenhouse backup cell is spent, and the replacement is still on the dock. I can fit it when Pip gets here. After that, we can talk about opening the station for the other islands again.",
    focus: 'greenhouse',
  },
  {
    id: 'working-connections',
    speaker: 'Pip',
    role: 'Repair drone',
    title: 'The hardware is ready',
    text: "Motors checked. Cell secured. My route module still proposes the closed relay shortcut. The working connections are in the station dataset; the module needs to use them. Your bench has the service source and a local test console. Change the route function, inspect a run, then send me. I'll carry the cell. Mara has the socket open.",
    focus: 'relay',
  },
];

const continueLabel = (id: MissionId) => {
  const next = nextMission(id);
  return next ? `Continue to ${missionCatalog[next].title}` : 'Return to field map';
};

export const storyDebriefs: Record<MissionId, {
  title: string;
  text: string;
  speaker: string;
  nextLabel: string;
}> = {
  'first-light': {
    title: 'A light at the far window',
    text: "The cell is here. I can take the greenhouse off its shutdown list. Your route got Pip around the broken bridge; the bridge still needs a repair crew. Neri spotted another problem while unloading. The dock console counted the same receipt more than once. Before we promise supplies to anyone, we need to know which deliveries we've actually accepted.",
    speaker: 'Mara',
    nextLabel: 'Continue to supply dock',
  },
  'one-crate-one-receipt': {
    title: 'A manifest we can sign',
    text: "The accepted receipts hold steady when the scanner repeats itself. I can sign this manifest without counting a crate twice. Mara has greenhouse power, and the dock has a record we can hand to the next shift. The observatory is still sending mixed temperature packets. Take your tool case uphill and help her distinguish a cold reading from a damaged line.",
    speaker: 'Neri',
    nextLabel: continueLabel('one-crate-one-receipt'),
  },
  'read-the-weather': {
    title: 'A reading, not a guess', speaker: 'Mara',
    text: "I can read the instrument panel again. The rejected packets stay in the tray, so nobody mistakes a damaged line for a freezing bed. Your returned temperatures are on the observatory display. Neri needs the same care down at the store. Supplies are leaving those bins now, and an impossible withdrawal must not consume the next delivery.",
    nextLabel: continueLabel('read-the-weather'),
  },
  'balance-the-store': {
    title: 'The bins tell the truth', speaker: 'Neri',
    text: "The ledger now leaves an unfilled request beside the bin instead of borrowing from a delivery that hasn't arrived. I can reserve ferry space against these balances. Mara has a different shortage at the greenhouse. Cloud cover has cut the battery budget. She has written down the priorities, but the controller still needs to honor them without stopping at the first oversized request.",
    nextLabel: continueLabel('balance-the-store'),
  },
  'share-the-battery': {
    title: 'Enough for the right jobs', speaker: 'Mara',
    text: "The appliances on your allocation list have their full grants. The others stay off, and the remaining energy is still accounted for. That gives us a policy we can explain rather than a lucky combination of switches. Pip is waiting at the workshop junction. Some repair jobs can start together; others still depend on parts we don't have.",
    nextLabel: continueLabel('share-the-battery'),
  },
  'open-the-workshop': {
    title: 'The first benches are working', speaker: 'Pip',
    text: "The ready jobs moved in batches. I committed each wave before checking the next one, so no bench borrowed a part that was still being made. Missing and circular requirements remain on the blocked board. Mara can use the repaired equipment in the garden now. Her moisture probes still jump around, and each sensor needs its own recent-reading window.",
    nextLabel: continueLabel('open-the-workshop'),
  },
  'steady-the-sensors': {
    title: 'Each bed keeps its own evidence', speaker: 'Mara',
    text: "The raw arrivals are still visible beside your means. I can see which samples contributed, including the one on the window boundary. A wet reading from another bed no longer changes this sensor's display. Next I need the nursery's daily record. Germination isn't a growing day, and a tray that is ready must stay ready in our model.",
    nextLabel: continueLabel('steady-the-sensors'),
  },
  'raise-the-seedlings': {
    title: 'Ready trays have a history', speaker: 'Mara',
    text: "I can walk through each returned day and see how the bed reached its final state. No favorable day was counted twice, and the terminal trays keep their status when the weather changes. That is a nursery record I can prepare a transfer from. The relay has been repeating our notices too quickly. Pip needs a finite retry schedule before we announce anything.",
    nextLabel: continueLabel('raise-the-seedlings'),
  },
  'give-the-radio-a-rest': {
    title: 'A schedule with a stopping point', speaker: 'Pip',
    text: "Your retry markers are on the relay timeline. The delays stop growing at the cap, and exhausted messages wait for a person instead of sending forever. This is a schedule, not proof that a radio packet arrived. Neri is bringing the nursery carts next. The airlock lane has limited space, so we need to account for departures before admitting new arrivals.",
    nextLabel: continueLabel('give-the-radio-a-rest'),
  },
  'keep-the-airlock-clear': {
    title: 'Room to move without losing a cart', speaker: 'Neri',
    text: "The old queue leaves first. New carts take the remaining places, and a turned-away cart doesn't quietly reappear on a later tick. I can inspect every frame before moving the nursery trays. One last record remains at the relay. Notices arrive out of order there, and a stale announcement must not reopen a service that somebody has withdrawn.",
    nextLabel: continueLabel('keep-the-airlock-clear'),
  },
  'agree-on-the-beacon': {
    title: 'Ready for the next crossing', speaker: 'Neri',
    text: "The service board keeps the newer notices and remembers the versions of withdrawn offers. An old packet cannot bring a deleted promise back. Mara can point to the nursery record, the store balances, and the working benches behind each offer. All eleven services have earned their checks. I'll take this board to the ferry office. Your bench will still be here when you return.",
    nextLabel: continueLabel('agree-on-the-beacon'),
  },
};

export const campaignStory: {
  title: string;
  tagline: string;
  premise: string;
  playerRole: string;
  chapters: {
    id: string;
    title: string;
    logline: string;
    stakes: string;
    payoff: string;
  }[];
} = {
  title: 'The next crossing',
  tagline: 'Make the station useful. Make its promises trustworthy.',
  premise: 'Aster is a coastal field station in a near-future archipelago. After a winter of patched equipment and reduced ferry service, its keepers want to reopen their shared workshop and plant nursery. A southerly weather front limits the coming ferry schedule. Repairs must make local services dependable before the old relay can publish what the station can actually offer its neighbors.',
  playerRole: "You returned for a maintenance week. After years overseeing other people's builds, you want your hands on a repair you can walk over and look at.",
  chapters: [
    {
      id: 'first-light',
      title: 'First light',
      logline: 'Bring a replacement power cell to Mara without sending Pip across the closed shortcut.',
      stakes: 'The greenhouse cannot resume its work while the cell waits on the dock. A line on an old map is not a working connection.',
      payoff: 'Pip reaches the greenhouse by an accepted route and its windows light. The broken bridge remains closed. Mara directs you to Neri at the supply dock.',
    },
    {
      id: 'one-crate-one-receipt',
      title: 'One crate, one receipt',
      logline: 'Give Neri a manifest that accepts each new receipt once, even when the scanner repeats a conflicting copy.',
      stakes: 'Repeated scans have made the station appear better supplied than its accepted deliveries support. Neri will not sign that promise.',
      payoff: 'Accepted deliveries enter storage once. Replay with the returned receipt history adds nothing. Neri signs the manifest and sends you to the weather instruments.',
    },
    {
      id: 'read-the-weather',
      title: 'Read the weather',
      logline: 'Decode the mixed temperature packets before Mara reconnects the greenhouse instrument panel.',
      stakes: 'A damaged line must not become a false temperature. The crew needs to distinguish rejected data from a valid cold reading.',
      payoff: 'Valid readings move labeled thermometers. Rejected source lines remain in the packet tray, available for inspection rather than silently replaced with zero.',
    },
    {
      id: 'balance-the-store',
      title: 'Balance the store',
      logline: 'Account for supplies as Mara and the workshop make withdrawals from the newly reliable dock record.',
      stakes: 'Neri needs to reserve space on the next ferry. An impossible withdrawal cannot consume stock or cancel later arrivals.',
      payoff: 'Bins follow accepted ledger rows in order. Unfilled requests wait beside unchanged bins, giving the crew an honest resupply list.',
    },
    {
      id: 'share-the-battery',
      title: 'Share the battery',
      logline: 'Implement the crew\'s stated power priorities while cloud cover reduces the station\'s available energy budget.',
      stakes: 'The pump, heater, and status beacon cannot all receive a full allocation. Mara needs the policy to explain what runs and what waits.',
      payoff: 'Granted appliances run within the supplied budget. A request that cannot fit stays off without preventing a smaller later grant.',
    },
    {
      id: 'open-the-workshop',
      title: 'Open the workshop',
      logline: 'Put the repair benches back to work in dependency-ready batches instead of waiting for every missing part.',
      stakes: 'Some jobs need unfinished parts, while others refer to missing or circular requirements. Independent repairs must still proceed.',
      payoff: 'Ready benches work in waves. Blocked links remain visible. The crew gains a useful workshop without declaring every repair finished.',
    },
    {
      id: 'steady-the-sensors',
      title: 'Steady the sensors',
      logline: 'Help Mara inspect noisy moisture probes with a separate recent-reading window for each sensor.',
      stakes: 'A stale wet sample or a reading from another bed can mislead the irrigation display. Smoothing must leave the raw evidence visible.',
      payoff: 'Each arrival produces its own sensor mean. Playback highlights contributing samples beside the raw trace, including the delay smoothing introduces.',
    },
    {
      id: 'raise-the-seedlings',
      title: 'Raise the seedlings',
      logline: 'Restore the nursery\'s daily state record so Mara can account for which beds are ready for transfer.',
      stakes: 'Germination and later growth are different transitions. The station cannot promise ready trays by counting the same favorable day twice.',
      payoff: 'The day slider shows each returned bed state. Ready and wilted beds stay terminal under the disclosed toy model. Mara can prepare the ready trays for dispatch.',
    },
    {
      id: 'give-the-radio-a-rest',
      title: 'Give the radio a rest',
      logline: 'Space the old relay\'s failed sends instead of flooding its local retry schedule.',
      stakes: 'Reconnected equipment has a backlog of status notices. Endless immediate retries hide which messages still need a person\'s attention.',
      payoff: 'Retry markers spread by the specified capped delays. Exhausted messages move to a visible tray. A schedule does not guarantee radio delivery.',
    },
    {
      id: 'keep-the-airlock-clear',
      title: 'Keep the airlock clear',
      logline: 'Admit carts to the nursery\'s salt-spray airlock without overfilling its painted waiting lane.',
      stakes: 'The ferry collection brings a burst of carts. Neri needs departures, waiting carts, and rejected arrivals accounted for separately.',
      payoff: 'Old carts leave before new arrivals seek a place. Frame-by-frame playback shows the bounded queue; turned-away carts never slip into later service.',
    },
    {
      id: 'agree-on-the-beacon',
      title: 'Agree on the beacon',
      logline: 'Reconstruct the station service board from versioned relay notices, retaining deletions when stale packets arrive.',
      stakes: 'An old open notice must not resurrect a withdrawn service. Neri needs the board to report current offers before arranging the next crossing.',
      payoff: 'The board retains newer notices and deletion versions. Mara posts only supported station services. The crew can plan a crossing from an inspectable record, not a blanket all-clear.',
    },
  ],
};
