import type { Character, JEvent, LevelInfo, Segment, Session, SourceInfo, Stats } from "../journey";

// What one addon's saved file adds to a character's journey. merge.ts puts
// the pieces from all three together.
export interface Contribution {
  source: SourceInfo;
  character: Partial<Character>;
  events?: JEvent[];
  segments?: Segment[];
  kills?: { d: string; names: string[] };
  levels?: LevelInfo[];
  sessions?: Session[];
  stats?: Stats;
  zones?: Record<string, string>;
  items?: Record<string, string>;
  utcOffset?: number; // seconds the PC clock is ahead of UTC (our addon saves it)
}

// Where a file was found: WTF\Account\<account>\<realm>\<character>\SavedVariables\<file>
export interface FileContext {
  realm?: string;
  character?: string;
}
