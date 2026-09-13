import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './lib/api';
import { useToast, errorText } from './lib/toast';
import type { ShuffleRun } from './types';
import LoginScreen from './components/LoginScreen';
import Header from './components/Header';
import PlaylistSidebar from './components/PlaylistSidebar';
import Workspace from './components/Workspace';
import PreviewModal from './components/PreviewModal';
import SuccessCard from './components/SuccessCard';

export default function App() {
  const queryClient = useQueryClient();
  const auth = useQuery({ queryKey: ['auth'], queryFn: api.authStatus });
  // Vom API-Wrapper gemeldet, wenn die Session serverseitig weg ist -> Login-Screen
  useEffect(() => {
    const onExpired = () => queryClient.invalidateQueries({ queryKey: ['auth'] });
    window.addEventListener('auth-expired', onExpired);
    return () => window.removeEventListener('auth-expired', onExpired);
  }, [queryClient]);

  if (auth.isLoading) {
    return <Center>Lade&nbsp;…</Center>;
  }
  if (auth.isError) {
    return <Center>Server nicht erreichbar. Läuft das Backend?</Center>;
  }
  if (!auth.data?.authenticated) {
    return <LoginScreen />;
  }
  return <MainApp displayName={auth.data.user?.displayName ?? auth.data.user?.id ?? 'Spotify-Account'} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-neutral-400">{children}</div>;
}

function MainApp({ displayName }: { displayName: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [playlistId, setPlaylistId] = useState<string | null>(null);
  const [previewRun, setPreviewRun] = useState<ShuffleRun | null>(null);
  const [successRun, setSuccessRun] = useState<ShuffleRun | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * Würfelt neu und schreibt die Shadow-Playlist. Die Wiedergabe startet die
   * App nicht selbst — Übergabe an die Spotify-App über die Erfolgskarte.
   */
  const runShuffle = useCallback(
    async (opts: { preview: boolean; seed?: string }) => {
      if (!playlistId) return;
      setBusy(true);
      try {
        const run = await api.shuffle(playlistId, opts.seed);
        if (run.skippedOrphans && run.skippedOrphans.length > 0) {
          toast('info', `${run.skippedOrphans.length} verwaiste Blockeinträge wurden übersprungen.`);
        }
        if (opts.preview) {
          setPreviewRun(run);
        } else {
          setSuccessRun(run);
        }
        // Sync könnte die Trackliste verändert haben
        queryClient.invalidateQueries({ queryKey: ['playlist', playlistId] });
      } catch (err) {
        toast('error', errorText(err));
      } finally {
        setBusy(false);
      }
    },
    [playlistId, queryClient, toast],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
    queryClient.clear();
    location.reload();
  }, [queryClient]);

  return (
    <div className="flex h-full flex-col">
      <Header
        displayName={displayName}
        canShuffle={playlistId !== null && !busy}
        busy={busy}
        onRoll={() => runShuffle({ preview: false })}
        onPreview={() => runShuffle({ preview: true })}
        onLogout={logout}
      />
      <div className="flex min-h-0 flex-1">
        {/* Mobil: entweder Liste oder Arbeitsbereich; ab md beides nebeneinander */}
        <div className={`${playlistId ? 'hidden md:flex' : 'flex'} w-full md:w-80`}>
          <PlaylistSidebar selectedId={playlistId} onSelect={setPlaylistId} />
        </div>
        <main className={`${playlistId ? 'block' : 'hidden md:block'} min-w-0 flex-1 overflow-y-auto`}>
          {playlistId ? (
            <Workspace playlistId={playlistId} onBack={() => setPlaylistId(null)} />
          ) : (
            <Center>Wähle links eine Playlist aus.</Center>
          )}
        </main>
      </div>
      {previewRun && (
        <PreviewModal
          run={previewRun}
          busy={busy}
          onClose={() => setPreviewRun(null)}
          onReshuffle={(seed) => runShuffle({ preview: true, seed })}
        />
      )}
      {successRun && <SuccessCard run={successRun} onClose={() => setSuccessRun(null)} />}
    </div>
  );
}
