# Flugsimulator Schleching

Ein Flugspiel im Browser: Flieg mit einem kleinen Propellerflugzeug durch die echte
Berglandschaft rund um Schleching im Chiemgau.

**Spielen:** https://konradthoma.github.io/flugsimulator-schleching/

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

Tipp fürs iPad: In Safari auf „Teilen → Zum Home-Bildschirm“ tippen, dann läuft das Spiel im Vollbild.

## Entwickeln

```bash
npm install
npm run dev        # Spiel lokal starten: http://localhost:5173
npm run terrain    # Höhendaten neu herunterladen (nur nötig, wenn sich das Gebiet ändert)
```

Jede Änderung auf `main` wird automatisch auf GitHub Pages veröffentlicht.

Höhendaten: AWS Terrain Tiles (Mapzen, Copernicus, SRTM u. a.).
