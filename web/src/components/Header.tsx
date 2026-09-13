interface Props {
  displayName: string;
  canShuffle: boolean;
  busy: boolean;
  onRoll: () => void;
  onPreview: () => void;
  onLogout: () => void;
}

export default function Header(props: Props) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-900 px-4 py-3">
      <span className="text-lg font-bold">🔀 Plex Blockshuffle</span>

      <div className="ml-auto flex flex-wrap items-center gap-3">
        <button
          onClick={props.onPreview}
          disabled={!props.canShuffle}
          className="rounded-md border border-neutral-600 px-3 py-1.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-40"
        >
          Vorschau
        </button>
        <button
          onClick={props.onRoll}
          disabled={!props.canShuffle}
          title="Würfelt die Reihenfolge und schreibt sie als Playlist auf deinen Plex-Server"
          className="rounded-md bg-green-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-40"
        >
          {props.busy ? 'Würfle …' : 'Neu würfeln'}
        </button>

        <span className="hidden text-sm text-neutral-400 sm:inline" title="Verbundener Account">
          {props.displayName}
        </span>
        <button
          onClick={props.onLogout}
          className="text-sm text-neutral-500 underline-offset-2 hover:text-neutral-300 hover:underline"
        >
          Abmelden
        </button>
      </div>
    </header>
  );
}
