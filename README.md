# Flugsimulator Schleching

Ein Flugspiel im Browser: Flieg mit Flugzeugen und Hubschraubern durch die echte
Landschaft des Chiemgaus – von Schleching und Kössen bis über den Chiemsee (23 × 36 km).
Berge, Tiroler Ache, Seen, Wald, Straßen und alle Gebäude stammen aus echten Kartendaten;
gestartet wird am Segelflugplatz Unterwössen.

**Spielen:** https://konradthoma.github.io/flugsimulator-schleching/

## So geht's

Das Menü hat vier Reiter: **Spielen**, **Hangar**, **Rekorde** und **Einstellungen**.

Spiele:

- **Münzen sammeln:** Goldene Münzen geben 1 Punkt, blaue Münzen über den Gipfeln 5 Punkte.
  Alle Münzen geschafft = 50 Bonuspunkte.
- **Ringrennen:** 16 Ringe in der richtigen Reihenfolge, die Zeit läuft vom grünen bis zum weißen Ring.
  Ziel = 10 Punkte, neue Bestzeit = 20 Punkte extra.
- **Missionen:** Erste Landung, Paketdienst, Tiefflug im Tal, Gipfeltour sowie – nur mit Hubschrauber –
  Bergrettung und Gipfellandung. Beim ersten Mal gibt es die volle Belohnung (40–120 Punkte).
- **Freiflug:** Start auf dem Flugplatz bei Schleching, ohne Ziel und ohne Zeit.
- **Vulkan Hochplatte:** Die Hochplatte bricht aus – Lava fließt ins Tal, Lavabomben fliegen, eine Aschesäule steigt auf. Je näher am Krater, desto schneller gibt es Punkte.

Im **Hangar** kauft man mit den Punkten neue Fluggeräte und Extras:

| Fluggerät | Art | Preis |
|---|---|---|
| Piccolo | Propellerflugzeug | von Anfang an |
| Falke | Sportflugzeug | 150 |
| Libelle | kleiner Hubschrauber | 250 |
| Blitz | Düsenjet | 600 |
| Bergadler | Rettungshubschrauber | 900 |

Extras: Münzmagnet (120), Goldlackierung (200), Turbo (350) – einzeln ein- und ausschaltbar.

**Landen:** Flugzeuge brauchen ebenen Boden (am besten die Landebahn): Gas raus – mit Flughilfe
sinkt das Flugzeug dann sanft –, Flügel waagerecht, nicht schneller als 5 m/s sinken. Hubschrauber
landen fast überall, nur nicht zu schnell und nicht am Steilhang. Der Schatten unter dem Fluggerät hilft.

In den **Einstellungen** gibt es außerdem Abendstimmung, böigen Wind und das Motorgeräusch.
Die besten 5 Münzflüge und Rennzeiten stehen unter **Rekorde**. Alles wird im Browser gespeichert.

## Steuerung

| Tastatur | iPad | Flugzeug | Hubschrauber |
|---|---|---|---|
| W / S | Regler rechts | Gas | steigen/sinken (Mitte = schweben) |
| ↑ / ↓ | Joystick hoch/runter | Nase runter/hoch | vorwärts/rückwärts |
| ← / → | Joystick links/rechts | kippen (Kurve) | drehen |
| A / D | – | Seitenruder, am Boden lenken | seitwärts |
| C | 📷 | Kamera wechseln | |
| H | Hilfe | Flughilfe an/aus | |
| P | ⏸ | Pause | |
| T | 1× | Zeitraffer: 1× · 1,5× · 2× · 3× | |
| Leertaste | ↻ | Neustart | |
| M | ✈ | Menü und Hangar | |

Tipp fürs iPad: In Safari auf „Teilen → Zum Home-Bildschirm“ tippen, dann läuft das Spiel im Vollbild.

## Entwickeln

```bash
npm install
npm run dev        # Spiel lokal starten: http://localhost:5173
npm run terrain    # Höhendaten neu herunterladen (nur nötig, wenn sich das Gebiet ändert)
npm run osm        # Kartendaten aus OpenStreetMap neu aufbereiten (nach npm run terrain)
```

Das Gebiet ist in `tools/region.mjs` festgelegt. `npm run osm` lädt Gewässer, Wald, Ortsflächen,
Straßen, Gebäude, Ortsnamen und Landebahnen über die Overpass-API (zwischengespeichert in
`tools/.osm-cache/`; für frische Daten den Ordner löschen) und schreibt nach `public/terrain/`:

| Datei | Inhalt |
|---|---|
| `schleching-height.bin.gz` | Höhen im 10-m-Raster |
| `schleching-land.bin.gz` | Bodenbedeckung im selben Raster (Wiese, Wald, Wasser, Ort, Fels …) |
| `schleching-features.json.gz` | Seen mit Wasserspiegel, Flüsse, Straßen, Bahn, Orte, Landebahnen |
| `schleching-buildings.bin.gz` | Gebäude als Rechtecke mit Höhe und Art |

Jede Änderung auf `main` wird automatisch auf GitHub Pages veröffentlicht.

Höhendaten: AWS Terrain Tiles (Mapzen, Copernicus, SRTM, data.gv.at u. a.).
Kartendaten: © [OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright), Lizenz ODbL.
