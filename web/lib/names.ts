/// Auto-assigned trader names.
///
/// Nobody should have to fill in a form before they exist on the board. A wallet
/// that has traded is already ranked, so the account it belongs to gets a name
/// the moment it signs in and can rename later if it wants a specific one.
///
/// Both lists are deliberately bland-but-vivid: no words that combine into
/// something insulting, no real brands, nothing that reads as an official
/// account. A name is handed out unattended, so it has to be safe unattended.

const ADJECTIVES = [
  "swift", "lunar", "solar", "quiet", "bold", "rapid", "nova", "cosmic",
  "amber", "jade", "onyx", "iron", "vivid", "prime", "zen", "hyper",
  "neon", "frost", "ember", "silent", "golden", "midnight", "crimson",
  "azure", "velvet", "cobalt", "arcane", "stellar", "tidal", "orbital",
  "polar", "electric", "marble", "copper", "glacial", "dusk", "dawn",
];

const NOUNS = [
  "otter", "falcon", "comet", "tiger", "koi", "crane", "fox", "wolf",
  "moth", "heron", "lynx", "raven", "orca", "ibis", "gecko", "panda",
  "bison", "hawk", "seal", "newt", "viper", "moose", "egret", "badger",
  "marten", "tapir", "lemur", "quokka", "axolotl", "puffin", "narwhal",
  "meerkat", "osprey", "kestrel", "manta", "pangolin", "ocelot",
];

const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/// The store's handle regex allows 3-20 characters. Generated names must fit
/// inside it or the auto-provision silently fails on the longest word pairs.
export const MAX_GENERATED_LENGTH = 20;

export type GeneratedName = { handle: string; display: string };

/// One candidate. Uniqueness is the caller's problem -- it needs the store.
///
/// `attempt` widens the number as collisions mount, so a crowded namespace
/// degrades into more digits rather than into an infinite retry loop.
export function generateName(attempt = 0): GeneratedName {
  const a = pick(ADJECTIVES);
  const n = pick(NOUNS);

  // The digit count comes from what is left of the 20-character budget, not
  // from the attempt alone: the longest pair here is 16 characters, so an
  // escalating six-digit suffix produced handles the store would reject.
  const room = MAX_GENERATED_LENGTH - (a.length + n.length);
  const wanted = attempt < 3 ? 2 : attempt < 6 ? 3 : 4;
  const digits = Math.max(1, Math.min(room, wanted));
  const num = Math.floor(Math.random() * 10 ** digits);

  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  return { handle: `${a}${n}${num}`, display: `${cap(a)} ${cap(n)}` };
}

