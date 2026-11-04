# Flugsimulator Schleching

Ein Flugspiel im Browser: Flieg mit einem kleinen Propellerflugzeug durch die echte
Berglandschaft rund um Schleching im Chiemgau.

**Spielen:** https://konradthoma.github.io/flugsimulator-schleching/

## So geht's

Wähle im Menü ein Spiel und ein Flugzeug (Piccolo, Falke oder Blitz):

- **Münzen sammeln:** Goldene Münzen geben 1 Punkt, blaue Münzen über den Gipfeln 5 Punkte.
  Lichtsäulen zeigen, wo Münzreihen liegen. Alle Münzen geschafft = 50 Bonuspunkte.
- **Ringrennen:** Flieg durch 16 Ringe in der richtigen Reihenfolge. Die Zeit startet am grünen
  Ring und stoppt am weißen Zielring. Für jedes Flugzeug gibt es eine eigene Bestzeit.
  Ins Ziel kommen bringt 10 Punkte, eine neue Bestzeit 20 Punkte extra.

Achtung: Andere Flugzeuge kreisen über der Gegend. Weich ihnen aus!

In den **Einstellungen** im Menü kann man andere Flugzeuge, Lichtsäulen, den Wegweiser-Pfeil
und die Töne ausschalten. Punkte, Bestzeiten und Einstellungen werden im Browser gespeichert.

## Steuerung

| Tastatur | iPad | Wirkung |
|---|---|---|
| W / S | Gas-Regler rechts | Gas |
| ↑ / ↓ | Joystick hoch/runter | Nase runter/hoch |
| ← / → | Joystick links/rechts | kippen (Kurve) |
| A / D | – | Seitenruder |
| C | 📷 | Kamera wechseln |
| H | Hilfe | Flughilfe an/aus |
| Leertaste | ↻ | Neustart |
| M | ✈ | Flugzeug wählen |

Tipp fürs iPad: In Safari auf „Teilen → Zum Home-Bildschirm“ tippen, dann läuft das Spiel im Vollbild.

## Entwickeln

```bash
npm install
npm run dev        # Spiel lokal starten: http://localhost:5173
npm run terrain    # Höhendaten neu herunterladen (nur nötig, wenn sich das Gebiet ändert)
```

Jede Änderung auf `main` wird automatisch auf GitHub Pages veröffentlicht.

Höhendaten: AWS Terrain Tiles (Mapzen, Copernicus, SRTM u. a.).
