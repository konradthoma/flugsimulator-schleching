# Flugsimulator Schleching

Ein Flugspiel im Browser: Flieg mit einem kleinen Propellerflugzeug durch die echte
Berglandschaft rund um Schleching im Chiemgau.

**Spielen:** https://konradthoma.github.io/flugsimulator-schleching/

## So geht's

Wähle ein Flugzeug (Piccolo, Falke oder Blitz) und sammle Münzen:
goldene Münzen geben 1 Punkt, blaue Münzen über den Gipfeln 5 Punkte.
Wer alle Münzen schafft, bekommt 50 Bonuspunkte. Der gelbe Pfeil zeigt zur nächsten Münze.
Deine Punkte werden im Browser gespeichert.

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
