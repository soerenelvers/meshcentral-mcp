# Änderungen

## 0.2.0

- Natives MeshCentral-Plugin mit Installationsmanifest und Konfigurationspanel.
- MCP und OAuth unter der vorhandenen HTTPS-Adresse, ohne zusätzlichen Container.
- Abhängigkeiten als CommonJS-Bundle enthalten; keine npm-Installation im laufenden MeshCentral.
- Konfiguration außerhalb des Pluginordners; Gerätefreigaben und CSRF-geschützte Admin-Konfiguration.
- Deaktivierte Plugins blockieren weitere MCP-Anfragen.
- Eigenständiger Dienst bleibt als alternative Betriebsart verfügbar; lokale Konfiguration jetzt `bridge.config.json`.

## 0.1.0

- Eigenständiger MCP-Dienst mit OAuth, Podman-Vorlage und Geräte-/Befehlswerkzeugen.
