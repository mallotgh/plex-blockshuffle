import { z } from 'zod';

/** Antwortformen des Plex Media Servers (JSON via Accept-Header), nur genutzte Felder. */

export const playlistMetaSchema = z.object({
  ratingKey: z.string(),
  title: z.string(),
  smart: z.boolean().optional(),
  leafCount: z.number().optional(),
  updatedAt: z.number().optional(),
  playlistType: z.string().optional(),
});

export const playlistsResponseSchema = z.object({
  MediaContainer: z.object({
    Metadata: z.array(playlistMetaSchema).default([]),
  }),
});

export const playlistDetailResponseSchema = z.object({
  MediaContainer: z.object({
    Metadata: z.array(playlistMetaSchema).min(1),
  }),
});

export const trackSchema = z.object({
  ratingKey: z.string(),
  title: z.string(),
  /** Interpret */
  grandparentTitle: z.string().optional(),
  originalTitle: z.string().nullable().optional(),
  /** Album */
  parentTitle: z.string().optional(),
  duration: z.number().optional(),
  type: z.string().optional(),
});

export const playlistItemsResponseSchema = z.object({
  MediaContainer: z.object({
    size: z.number().optional(),
    totalSize: z.number().optional(),
    Metadata: z.array(trackSchema).default([]),
  }),
});

export type PlexTrack = z.infer<typeof trackSchema>;
