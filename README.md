# MeshCentral MCP Bridge 0.2.0

Natives MeshCentral-Server-Plugin. Installation über **Mein Server → Plugins → Plugin herunterladen**. MCP und OAuth laufen im bestehenden MeshCentral-Webserver; kein zusätzlicher Podman-Container und keine zweite Subdomain erforderlich.

## Installations-URL

```text
https://raw.githubusercontent.com/soerenelvers/meshcentral-mcp/main/config.json
```

Das Feld „Plugin Download URL“ erwartet dieses JSON-Manifest, nicht den ZIP-Link. Das Manifest verweist auf das vollständige ZIP mit Pluginmodul und vorgebauten Abhängigkeiten.

## Einrichten

1. In MeshCentral als vollständiger Administrator anmelden.
2. **Mein Server → Plugins → Plugin herunterladen** öffnen und die Installations-URL eingeben.
3. Das Plugin **MeshCentral MCP Bridge** installieren/aktivieren. Falls die Liste zunächst nur einen verfügbaren Download anzeigt, in **Aktion** die Installation starten.
4. **MeshCentral neu starten**, damit die HTTP-Hooks vor den vorhandenen Webseitenrouten registriert werden.
5. Das Konfigurationspanel des Plugins öffnen. Alternativ auf dem eigenen MeshCentral-Server den relativen Pfad `pluginadmin.ashx?pin=meshcentralmcp` öffnen.
6. Folgende Werte eingeben:

| Feld | Beispiel / Bedeutung |
|---|---|
| MCP-Basisadresse | `https://mesh.example.com/meshcentral-mcp` — eigene MeshCentral-Adresse verwenden |
| MeshCentral-Adresse | `https://mesh.example.com/` — HTTPS-Adresse des vorhandenen Servers |
| MeshCentral-Servicekonto | Ein eigenes Konto mit Rechten ausschließlich auf die gewünschten Geräte |
| MeshCentral-Passwort | Passwort dieses Servicekontos; lokal im Panel eingeben |
| Brücken-Passwort | Eigenes Passwort mit mindestens 16 Zeichen für die OAuth-Verbindung von ChatGPT |
| Geräte-IDs | Vollständige IDs im Format `node/<domain>/<id>`, eine pro Zeile |
| Befehle freigeben | Optional; zunächst ausgeschaltet lassen |

Alle Beispieladressen und Kontonamen sind Platzhalter. Zugangsdaten nicht in GitHub oder Chatnachrichten eintragen. Vollständige Geräte-IDs sind in der Geräte-URL nach `gotonode=` sichtbar; dort steht oft nur der letzte Teil. In der Standarddomain wird `node//` davor gesetzt. Bei einer eigenen MeshCentral-Domain lautet die ID `node/<domain>/<letzter-Teil>`. Die ID nach der Einrichtung mit der Geräteübersicht bestätigen.

7. Konfiguration speichern. Die aktuelle MCP-URL wird im Panel angezeigt.
8. Ohne Login den MCP-Endpunkt prüfen: eine **401**-Antwort mit OAuth-Hinweis ist erwartet; **404** bedeutet häufig, dass der Neustart fehlt; **503** bedeutet deaktiviert oder unkonfiguriert.
9. In ChatGPT im Webbrowser **Plugins → Plus → Eigenen MCP-Server hinzufügen** öffnen.
10. Name `MeshCentral`; Server-URL aus dem Panel übernehmen, beispielsweise `https://mesh.example.com/meshcentral-mcp/mcp`.
11. Authentifizierung **OAuth** wählen. Dynamische Clientregistrierung (**DCR**) verwenden; keine statische Client-ID/kein Client-Secret erforderlich. CIMD wird nicht implementiert.
12. Plugin erstellen, installieren und verbinden. Auf der Anmeldeseite das separate **Brücken-Passwort** eingeben und den Zugriff freigeben.

Erste Anfrage in einem neuen Chat:

> Zeige mit MeshCentral alle freigegebenen Geräte und prüfe ihren Status.

Wenn das funktioniert, bei Bedarf im Konfigurationspanel Befehle freigeben, speichern und die Werkzeuge/OAuth-Verbindung in ChatGPT aktualisieren. Anschließend zunächst einen kurzen, lesenden Befehl wie `hostname` testen.

## Werkzeuge

| Werkzeug | Funktion |
|---|---|
| `meshcentral_devices` | Freigegebene Geräte und Agent-Verbindungsstatus |
| `meshcentral_device_status` | Gerätestatus anhand einer vollständigen ID |
| `meshcentral_command_start` | Nicht interaktiver Linux-, CMD- oder PowerShell-Befehl; liefert eine Auftrags-ID |
| `meshcentral_command_result` | Rückmeldung zum Auftrag; maximal 64 KiB |

Kein grafischer Remote-Desktop, keine Dateiübertragung, keine interaktive Passwortabfrage. Ein OpenAI-API-Schlüssel ist nicht erforderlich.

## Anforderungen und Betriebsgrenzen

- MeshCentral mit Pluginunterstützung; Manifest-Mindestversion 1.1.35. Das native Modul verwendet `hook_setupHttpHandlers`, `server_startup`, `handleAdminReq` und `handleAdminPostReq`.
- Node.js **22 oder neuer**, gültiges HTTPS-Zertifikat und ausgehender HTTPS-Zugriff auf die eigene MeshCentral-Adresse. Das vorgebaute Bundle wurde unter Node.js 24 geprüft.
- Standarddomain unter dem URL-Wurzelpfad. Eigene URL-Domain-Unterpfade müssen vor Einsatz angepasst und getestet werden.
- Für ein Besitzerkonto ausgelegt. Das Servicekonto wird über MeshCentrals normalen Control-WebSocket angemeldet. MFA-/SSO-Zwang dieses Kontos kann die unbeaufsichtigte Anmeldung blockieren; solche Schutzfunktionen nicht dafür abschalten.
- Die Brücke prüft TLS-Zertifikate, Gerätefreigabeliste und MeshCentral-Servicekonto-Rechte. Ein MeshCentral-Server-Masterschlüssel wird nicht verwendet.
- Nicht interaktive Befehle können mit root-/SYSTEM-Rechten laufen. Die Gerätefreigabe ist keine Shell-Sandbox. Befehle sind standardmäßig ausgeschaltet.
- Ein Timeout beendet nur die Wartezeit, nicht den entfernten Prozess. Keine automatische Wiederholung bei unbekannter Ausführung. Eine Bestätigung `acknowledged` beweist keinen erfolgreichen Abschluss. `response_received` enthält eine Agent-Rückmeldung; ein unabhängig verifizierter Exit-Code ist nicht vorhanden.
- MeshCentral selbst kann Befehlsinhalte und Ausgaben in Ereignissen/Konsolen speichern. Keine Zugangsdaten in Befehle einbetten.

## Speicherung und Deaktivierung

Die private Konfiguration liegt außerhalb des Pluginordners unter `meshcentral-data/meshcentral-mcp/settings.json` (Verzeichnis 0700, Datei 0600). Sie enthält das Servicekonto-Passwort; das Brücken-Passwort wird als scrypt-Hash gespeichert. Das bestehende MeshCentral-Datenverzeichnis muss persistent und angemessen geschützt sein. Diese Dateien gehören nicht in das Repository.

OAuth-Clientregistrierungen werden im Unterordner `oauth` gespeichert. Tokens und Befehlsaufträge liegen im RAM; Neustart oder Konfigurationsänderung erfordern erneute OAuth-Anmeldung. Auftragsrückmeldungen verfallen nach einer Stunde. Updates überschreiben keine private Konfiguration.

Wird das Plugin in MeshCentral deaktiviert, blockiert der eingebundene Router neue MCP- und OAuth-Anfragen mit 503. Bereits an Geräte gesendete Befehle werden dadurch nicht abgebrochen. Nach einem Update MeshCentral neu starten, dann Werkzeuge und Verbindung in ChatGPT aktualisieren.

## Entwicklung und Tests

```bash
npm ci
npm run build:plugin
npm test
npm audit --omit=dev
```

Das vorgebaute CommonJS-Bundle `dist/bridge.cjs` gehört zur Installation. Es bündelt den MCP-SDK, Express, WebSocket-Client und Laufzeitabhängigkeiten. Der Pluginloader braucht keinen Zugriff auf ein separates `node_modules`-Verzeichnis. Lizenzhinweise der Abhängigkeiten liegen in `THIRD_PARTY_NOTICES.txt` und `dist/bridge.cjs.LEGAL.txt`.

Neun automatisierte Tests prüfen OAuth mit PKCE, Tokenrotation, MCP-Aufrufe, Geräte- und Scope-Grenzen, Rückmeldungszuordnung, fehlende automatische Wiederholung sowie den nativen Pluginloader, Adminrechte, CSRF, HTTPS-Pfadführung und Deaktivierung. **Eine Installation auf einem echten MeshCentral-Server wurde noch nicht durchgeführt.**

Der eigenständige Podman-Dienst bleibt optional verfügbar: [Anleitung](docs/STANDALONE.md). Seine lokale Konfiguration heißt jetzt `bridge.config.json`; das Root-`config.json` ist ausschließlich das MeshCentral-Installationsmanifest.

## Quellen

- MeshCentral-Pluginformat und Hooks: https://docs.meshcentral.com/meshcentral/plugins/
- Pluginloader: https://github.com/Ylianst/MeshCentral/blob/master/pluginHandler.js
- HTTP-Hooks und Adminpanel: https://github.com/Ylianst/MeshCentral/blob/master/webserver.js
- Control-Protokoll: https://github.com/Ylianst/MeshCentral/blob/master/meshctrl.js
- Agent-Rückmeldungen: https://github.com/Ylianst/MeshCentral/blob/master/agents/meshcore.js
- Eigene MCP-Plugins in ChatGPT: https://developers.openai.com/api/docs/guides/custom-mcp-server

Eigenständige Integration, kein offizielles MeshCentral- oder OpenAI-Plugin. Stand: 12.10.2026.
