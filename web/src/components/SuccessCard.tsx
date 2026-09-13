import { useEffect } from 'react';
import type { ShuffleRun } from '../types';

interface Props {
  run: ShuffleRun;
  onClose: () => void;
}

export default function SuccessCard({ run, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const openUrl = run.openUrl;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Würfeln erfolgreich"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-green-800 bg-neutral-900 p-6 shadow-2xl"
      >
        <div className="mb-3 flex items-start gap-3">
          <span className="text-2xl">✅</span>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold">Neu gewürfelt</h3>
            <p className="text-sm text-neutral-400">
              {run.blockCount} Blöcke · {run.trackCount} Tracks ·{' '}
              <code
                className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-green-300"
                title="Seed – gleiche Eingabe reproduziert exakt diese Reihenfolge"
              >
                Seed {run.seed}
              </code>
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded px-2 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
            title="Schließen (Esc)"
          >
            ✕
          </button>
        </div>

        {openUrl ? (
          <a
            href={openUrl}
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg bg-amber-600 px-4 py-2.5 text-center font-semibold text-white hover:bg-amber-500"
          >
            In Plex öffnen
          </a>
        ) : (
          <p className="text-sm text-amber-300">Shadow-Playlist nicht gefunden — bitte erneut würfeln.</p>
        )}

        <p className="mt-4 rounded-md bg-neutral-800/70 px-3 py-2 text-xs text-neutral-400">
          Wichtig: Beim Abspielen muss der <strong>Shuffle in Plex ausgeschaltet</strong> sein,
          sonst wird die berechnete Reihenfolge wieder durcheinandergewürfelt.
        </p>
      </div>
    </div>
  );
}
