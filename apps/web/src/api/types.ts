import type { components } from './schema';

// Short names for the generated API types (web rule: never hand-write API types).
type Schemas = components['schemas'];
export type Puzzle = Schemas['Puzzle'];
export type Attempt = Schemas['Attempt'];
export type Guess = Schemas['Guess'];
export type GuessResult = Schemas['GuessResult'];
export type Hint = Schemas['Hint'];
export type HintResult = Schemas['HintResult'];
export type Me = Schemas['Me'];
export type Stats = Schemas['Stats'];
export type Problem = Schemas['Problem'];
export type DailyLeaderboard = Schemas['DailyLeaderboard'];
export type DailyEntry = Schemas['DailyEntry'];
export type AllTimeLeaderboard = Schemas['AllTimeLeaderboard'];
export type Profile = Schemas['Profile'];
export type Archive = Schemas['Archive'];
export type ArchiveItem = Schemas['ArchiveItem'];
export type Metric = AllTimeLeaderboard['metric'];
