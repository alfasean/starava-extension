export interface Streams {
  time: number[];
  distance?: number[];
  heartrate?: number[];
  cadence?: number[];
  altitude?: number[];
  velocity_smooth?: number[];
  moving?: boolean[];
}

export interface ActivitySummary {
  id: number;
  name: string;
  type: string;
  startDate: string; // ISO
  distanceM: number;
  movingTimeSec: number;
  elapsedTimeSec: number;
  elevationGainM: number;
  workoutType: string | null;
}

export interface StravaSource {
  listActivities(opts: { page: number; perPage: number }, signal?: AbortSignal): Promise<ActivitySummary[]>;
  getActivity(id: number, signal?: AbortSignal): Promise<ActivitySummary>;
  /** Empty-ish Streams ({ time: [] }) if the activity has none. */
  getStreams(id: number, signal?: AbortSignal): Promise<Streams>;
}
