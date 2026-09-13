export interface AuthStatus {
  authenticated: boolean;
  user?: { id: string; displayName: string | null };
  server?: string | null;
}

export interface PlaylistSummary {
  id: string;
  name: string;
  smart: boolean;
  trackTotal: number;
  blockCount: number;
}

export interface TrackDto {
  id: string;
  name: string;
  artists: string[];
  albumName: string | null;
  durationMs: number;
}

export interface PlaylistTrack extends TrackDto {
  position: number;
  blockId: string | null;
}

export interface BlockItem {
  trackId: string;
  position: number;
  orphaned: boolean;
  track: TrackDto | null;
}

export interface Block {
  id: string;
  name: string;
  color: string;
  items: BlockItem[];
}

export interface PlaylistDetail {
  playlist: {
    id: string;
    name: string;
    smart: boolean;
    trackTotal: number;
    lastSyncedAt: number | null;
  };
  tracks: PlaylistTrack[];
  blocks: Block[];
}

export interface ShuffleRun {
  runId: string;
  playlistId: string;
  seed: string;
  createdAt: number;
  shadowPlaylistId: string | null;
  openUrl: string | null;
  blockCount: number;
  trackCount: number;
  units: {
    blockId: string | null;
    blockName: string | null;
    tracks: { trackId: string; track: TrackDto | null }[];
  }[];
  skippedOrphans?: { blockId: string; trackId: string }[];
}
