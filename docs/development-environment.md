# Entwicklungsumgebung für ApexCharts Card

## Übersicht

Dieses Dokument beschreibt die Einrichtung und Verwendung der virtuellen Entwicklungsumgebung für das ApexCharts Card Projekt.

## Voraussetzungen

- [Docker Desktop](https://www.docker.com/products/docker-desktop)
- [Visual Studio Code](https://code.visualstudio.com/)
- [Remote - Containers Extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

## Einrichtung der Entwicklungsumgebung

### 1. Repository klonen

```bash
git clone https://github.com/RomRider/apexcharts-card.git
cd apexcharts-card
```

### 2. DevContainer starten

1. Öffnen Sie das Projekt in VS Code
2. Klicken Sie auf das Symbol "Remote Window" in der unteren linken Ecke
3. Wählen Sie "Reopen in Container"

Der Container wird automatisch erstellt und konfiguriert. Dieser Prozess kann einige Minuten dauern.

### 3. Entwicklungsserver starten

Nachdem der Container gestartet ist, führen Sie folgende Befehle aus:

```bash
# Dependencies installieren
npm install

# Entwicklungsserver starten
npm run watch
```

## Features der Entwicklungsumgebung

### Integrierte Tools

- Node.js 20.x LTS
- Git und GitHub CLI
- TypeScript und ESLint
- Prettier für Code-Formatierung
- Home Assistant Integration

### VS Code Extensions

- TypeScript und JavaScript Support
- ESLint Integration
- GitLens für erweiterte Git-Funktionen
- Markdown Support
- GitHub Actions Integration
- Code Spell Checker

### Ports

- `8123`: Home Assistant Web Interface
- `5000`: Entwicklungsserver für die Karte

## Entwicklungsworkflow

### 1. Code-Änderungen

- Der Entwicklungsserver (`npm run watch`) überwacht automatisch Änderungen
- Änderungen werden sofort kompiliert und sind im Browser verfügbar

### 2. Testing

```bash
# Linting
npm run lint

# Build
npm run build
```

### 3. Debugging

- VS Code Debugger ist vorkonfiguriert
- Breakpoints können direkt im Code gesetzt werden
- Console.log Ausgaben erscheinen im VS Code Terminal

## Best Practices

### Git Workflow

1. Feature-Branches für neue Funktionen
2. Conventional Commits verwenden
3. Pull Requests über GitHub erstellen

### Code-Qualität

1. ESLint-Regeln befolgen
2. Prettier für konsistente Formatierung
3. TypeScript-Typen definieren
4. JSDoc-Kommentare verwenden

### Performance

1. Bundle-Größe überwachen
2. Lazy Loading implementieren
3. Caching-Strategien berücksichtigen

## Troubleshooting

### Häufige Probleme

1. **Container startet nicht**

   - Docker Desktop überprüfen
   - Port-Konflikte prüfen
   - Docker-Logs überprüfen

2. **Dependencies-Installation fehlgeschlagen**

   - `npm cache clean --force`
   - `rm -rf node_modules`
   - `npm install` erneut ausführen

3. **Entwicklungsserver nicht erreichbar**
   - Ports überprüfen
   - Firewall-Einstellungen prüfen
   - Container-Logs überprüfen

### Nützliche Befehle

```bash
# Container neu bauen
docker-compose build

# Container-Logs anzeigen
docker-compose logs -f

# Container neu starten
docker-compose restart
```

## Weiterführende Ressourcen

- [DevContainer Dokumentation](https://code.visualstudio.com/docs/remote/containers)
- [Home Assistant Development](https://developers.home-assistant.io/docs/development_environment)
- [TypeScript Dokumentation](https://www.typescriptlang.org/docs)
- [Lit Dokumentation](https://lit.dev/docs/)
