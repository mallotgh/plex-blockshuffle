# Plex Blockshuffle

Selbst gehostete Weboberfläche, die Audio-Playlists vom eigenen **Plex Media Server** lädt und darin **Blöcke** definiert: geordnete Gruppen von Tracks (z. B. Original → Sample A → Sample B), die beim Shuffle als Einheit behandelt werden. Die Reihenfolge der Blöcke ist zufällig, die Reihenfolge **innerhalb** eines Blocks bleibt fest.

Die App berechnet die Reihenfolge selbst (seedbarer Fisher-Yates über „Einheiten") und schreibt sie in eine **Shadow-Playlist** auf dem Plex-Server, die man ganz normal in Plex/Plexamp abspielt — bei ausgeschaltetem Shuffle. Player-Fernsteuerung gibt es bewusst nicht (Lehre aus dem Schwesterprojekt [spotify-blockshuffle](https://github.com/mallotgh/spotify-blockshuffle)).

## Funktionsweise

- **Anmeldung** über den offiziellen Plex-PIN-Flow (app.plex.tv). Jeder Nutzer meldet sich mit seinem eigenen Plex-Account an; die App findet den Musik-Server über plex.tv und spricht ihn über seine **Remote-Access-URL** (`…plex.direct`) an — die App muss dafür nicht im selben Netz laufen wie der Plex-Server.
- **Mehrbenutzer:** Playlists, Blöcke und Läufe sind strikt pro Nutzer getrennt. Zugang hat, wem der Plex-Server freigegeben ist — kein Nutzerlimit, kein Premium-Zwang, keine App-Registrierung.
- **Blöcke:** Ein Track darf zu mehreren Blöcken gehören (spielt dann einmal pro Block); Blöcke unter 2 Tracks werden automatisch aufgelöst. Verschwindet ein Track aus der Playlist, bleibt sein Blockeintrag als *verwaist* markiert erhalten und wird beim Shuffle übersprungen.
- **„Neu würfeln"** berechnet die Reihenfolge (Seed reproduzierbar) und schreibt sie in die Playlist `🔀 <Name> (Blockshuffle)` (Beschreibung: Blockzahl, Seed, Zeitstempel). **„In Plex öffnen"** führt direkt hin — dort abspielen, **Shuffle aus**.
- Smart-Playlists können als Quelle dienen (die Shadow-Playlist ist immer eine normale Playlist).

## Einrichtung

Es gibt **keine Zugangsdaten** zu hinterlegen — nur die eigene Adresse:

```bash
cp .env.example .env      # APP_BASE_URL setzen
docker compose up -d --build
```

Voraussetzungen auf Plex-Seite:
- Auf dem Plex-Server ist **Fernzugriff aktiv** (Einstellungen → Fernzugriff) — sonst erreicht die App den Server nur über das gedrosselte Plex-Relay oder gar nicht.
- Gäste brauchen eine **Server-Freigabe** (Plex: Einstellungen → Benutzer & Freigabe) für die Musik-Bibliothek.

### VPS hinter gemeinsamem Reverse Proxy (Caddy, Netz „edge")

```bash
docker network create edge              # einmalig
git clone https://github.com/mallotgh/plex-blockshuffle /opt/plex-blockshuffle
cd /opt/plex-blockshuffle
cp .env.example .env                    # APP_BASE_URL=https://<domain>
docker compose -f docker-compose.vps.yml up -d --build
```

`docker-compose.vps.yml` veröffentlicht **keinen Port**; erreichbar ist die App nur über den Proxy im `edge`-Netz, z. B. als Caddy-Site:

```
plexshuffle.example.de {
    encode zstd gzip
    reverse_proxy plex-blockshuffle:8973
}
```

Die App liest `X-Forwarded-*` (trustProxy), setzt Session-Cookies mit Secure-Flag (sobald `APP_BASE_URL` mit `https://` beginnt) und limitiert die Auth-Endpunkte.

## Umgebungsvariablen

| Variable | Default | Bedeutung |
|---|---|---|
| `APP_BASE_URL` | – | Öffentliche Adresse der App; Ziel der Plex-Login-Rückleitung |
| `PORT` | `8973` | Port des Webservers |
| `DATA_DIR` | `./data` (Container: `/config`) | SQLite-Datenbank + persistente Client-ID |
| `PLEX_PRODUCT` | `Plex Blockshuffle` | Anzeigename auf der Plex-Bestätigungsseite |

## Datensicherung

- Beim Start und täglich ein SQLite-Backup nach `/config/backups/` (die letzten 14 bleiben).
- Unten in der Playlist-Liste: Blockdefinitionen als JSON exportieren/additiv importieren (mit Konfliktanzeige).

## Troubleshooting

| Symptom | Ursache / Lösung |
|---|---|
| Login endet mit „Kein erreichbarer Plex-Server" | Fernzugriff auf dem Server aus, oder dem Account fehlt die Server-Freigabe. |
| „Der Plex-Server ist … nicht erreichbar" | Remote-Access-URL hat sich geändert (neue IP); die App löst automatisch neu auf — schlägt auch das fehl: Fernzugriff in Plex prüfen. |
| Reihenfolge stimmt beim Abspielen nicht | Shuffle in Plex/Plexamp ist aktiv — ausschalten. |
| Nach Neustart erneut Login nötig | `/config`-Volume nicht persistent gemountet. |

## Bewusst nicht enthalten

Player-Fernsteuerung (Plex Companion ist ähnlich launisch wie Spotify Connect), Cover-Bilder (bräuchten einen Token-behafteten Bild-Proxy), automatische Blockerkennung, gewichtete Blockwahrscheinlichkeiten, Genre-Regeln.
