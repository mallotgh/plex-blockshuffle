import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useToast, errorText } from '../lib/toast';

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface ImportSummary {
  imported: number;
  skipped: { playlist: string; block: string; reason: string }[];
}

export default function PlaylistSidebar({ selectedId, onSelect }: Props) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<ImportSummary | null>(null);
  const playlists = useQuery({ queryKey: ['playlists'], queryFn: () => api.playlists() });

  const exportBlocks = async () => {
    try {
      const res = await fetch('/api/export/blocks');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `blockshuffle-bloecke-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast('error', `Export fehlgeschlagen: ${errorText(err)}`);
    }
  };

  const importBlocks = async (file: File) => {
    try {
      const data: unknown = JSON.parse(await file.text());
      const result = await api.importBlocks(data);
      queryClient.invalidateQueries({ queryKey: ['playlists'] });
      queryClient.invalidateQueries({ queryKey: ['playlist'] });
      setImportResult(result);
    } catch (err) {
      toast('error', `Import fehlgeschlagen: ${errorText(err)}`);
    }
  };

  const refresh = async () => {
    await queryClient.fetchQuery({ queryKey: ['playlists'], queryFn: () => api.playlists(true) });
  };

  return (
    <aside className="flex w-full flex-col border-r border-neutral-800 bg-neutral-900/60 md:w-80 md:shrink-0">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Playlists</h2>
        <button
          onClick={refresh}
          disabled={playlists.isFetching}
          title="Playlists neu von Spotify laden"
          className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"
        >
          {playlists.isFetching ? '…' : '↻'}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {playlists.isLoading && <p className="px-4 py-2 text-sm text-neutral-500">Lade Playlists …</p>}
        {playlists.isError && (
          <p className="px-4 py-2 text-sm text-red-400">Playlists konnten nicht geladen werden.</p>
        )}
        <ul>
          {playlists.data?.playlists.map((pl) => (
            <li key={pl.id}>
              <button
                onClick={() => onSelect(pl.id)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-neutral-800 ${
                  selectedId === pl.id ? 'bg-neutral-800' : ''
                }`}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-neutral-700 text-lg">
                  🎵
                </div>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{pl.name}</span>
                  <span className="block text-xs text-neutral-500">
                    {pl.trackTotal} Tracks
                    {pl.smart && ' · Smart-Playlist'}
                  </span>
                </span>
                {pl.blockCount > 0 && (
                  <span
                    className="shrink-0 rounded-full bg-green-900 px-2 py-0.5 text-xs font-semibold text-green-300"
                    title={`${pl.blockCount} Blöcke definiert`}
                  >
                    {pl.blockCount}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center gap-3 border-t border-neutral-800 px-4 py-2">
        <button
          onClick={exportBlocks}
          title="Alle Blockdefinitionen als JSON-Datei sichern"
          className="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
        >
          Blöcke exportieren
        </button>
        <button
          onClick={() => fileInput.current?.click()}
          title="Blockdefinitionen aus einer Export-Datei einspielen (additiv)"
          className="text-xs text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
        >
          Blöcke importieren
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) importBlocks(file);
          }}
        />
      </div>

      {importResult && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setImportResult(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Import-Ergebnis"
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-neutral-700 bg-neutral-900 p-5 shadow-2xl"
          >
            <h3 className="mb-2 text-lg font-bold">Import abgeschlossen</h3>
            <p className="text-sm text-neutral-300">
              {importResult.imported} Blöcke importiert
              {importResult.skipped.length > 0 && `, ${importResult.skipped.length} übersprungen:`}
            </p>
            {importResult.skipped.length > 0 && (
              <ul className="mt-2 min-h-0 flex-1 overflow-y-auto text-xs text-neutral-400">
                {importResult.skipped.map((s, i) => (
                  <li key={i} className="border-b border-neutral-800 py-1">
                    <span className="text-neutral-300">{s.block}</span> ({s.playlist}) — {s.reason}
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => setImportResult(null)}
              className="mt-4 self-end rounded-md bg-neutral-700 px-4 py-1.5 text-sm font-medium hover:bg-neutral-600"
            >
              Schließen
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
