# MeshCentral MCP Bridge 0.1.0

Persönliches ChatGPT-Plugin über einen selbst gehosteten MCP-Server. `mesh.example.com`, `mcp-mesh.example.com` und `mcp-service` sind Platzhalter. Serveradressen, Kontoname und vollständige Geräte-ID bei der Einrichtung lokal eintragen.

## Funktionen

| Werkzeug | Funktion |
|---|---|
| `meshcentral_devices` | Freigegebene Geräte und Agent-Verbindungsstatus |
| `meshcentral_device_status` | Status eines Geräts anhand seiner vollständigen ID |
| `meshcentral_command_start` | Linux-Shell, Windows CMD oder PowerShell; liefert eine Auftrags-ID |
| `meshcentral_command_result` | Rückmeldung zu einem Auftrag; höchstens 64 KiB |

Befehle sind zunächst deaktiviert. Die Brücke bietet nicht interaktive Befehle, keine grafische Desktopsteuerung, Dateiübertragung oder interaktive Terminaldialoge. Sie braucht keinen OpenAI-API-Schlüssel.

## Aufbau und Grenzen

ChatGPT → HTTPS + OAuth/PKCE → MCP-Brücke → verschlüsselter MeshCentral-Control-WebSocket → Geräteagent.

Die Brücke prüft Zertifikate und beschränkt jedes Gerät auf die lokale Freigabeliste. Zusätzlich gelten die Rechte des MeshCentral-Kontos. Der MCP-Benutzer bekommt keine MeshCentral-Zugangsdaten: diese liegen in einem Podman-Secret. Das separate Brücken-Passwort wird nur als scrypt-Hash gespeichert.

Version 0.1 ist für einen Besitzer und ein ChatGPT-Konto gedacht. OAuth mit dynamischer Clientregistrierung und PKCE S256 ist implementiert; Clientregistrierungen bleiben im Datenvolume erhalten. OAuth-Tokens und Befehlsrückmeldungen liegen im RAM. Nach einem Neustart in ChatGPT erneut verbinden/anmelden. Rückmeldungen verfallen nach einer Stunde. Neue OAuth-Freigabe ist auch nötig, wenn der Berechtigungsumfang erweitert wird.

Nicht interaktive Befehle laufen mit Agent-Rechten, unter Linux möglicherweise als root, unter Windows häufig als SYSTEM. Ein Shelltext kann beliebige Änderungen vornehmen; die Gerätefreigabe ist keine Befehls-Sandbox. MeshCentral kann Befehlsinhalte und Ausgaben in seinen eigenen Ereignissen/Konsolen speichern. Keine Passwörter als Befehle übergeben.

`pending` bedeutet: Rückmeldung später erneut abfragen. Ein Timeout beendet nur die Wartezeit der Brücke, **nicht** den entfernten Prozess. Die Brücke wiederholt Befehle nicht. Bei `acknowledged` ist nur eine Bestätigung eingegangen. `response_received` enthält eine Agent-Rückmeldung; der Exit-Code wird vom verwendeten MeshCentral-Protokoll nicht unabhängig nachgewiesen. Bei unklarer Ausführung vor Wiederholung den tatsächlichen Gerätezustand prüfen.

## 1. Ablage vorbereiten

ZIP entpacken. Das Verzeichnis `meshcentral-mcp` vollständig nach `/opt/meshcentral-mcp` auf dem gewünschten Host übertragen. Die Befehle als derselbe Linux-Benutzer ausführen, der auch den neuen rootlosen Podman-Container betreiben soll; nicht zwischen `podman` und `sudo podman` wechseln.

```bash
sudo mkdir -p /opt/meshcentral-mcp
sudo chown "$USER":"$(id -gn)" /opt/meshcentral-mcp
cd /opt/meshcentral-mcp
podman --version
podman info --format '{{.Host.CgroupsVersion}}'
```

Voraussetzungen: Podman mit Quadlet (4.4 oder neuer), cgroup v2, systemd-Benutzersitzung und ausgehender HTTPS-Zugriff zu MeshCentral und zum Container-/npm-Registry. Auf einem älteren Podman-System zuerst prüfen, ob `/usr/lib/systemd/system-generators/podman-system-generator` vorhanden ist. Ein Produktions-Containerbuild wurde in der Erstellungsumgebung mangels Podman nicht ausgeführt.

## 2. Zugang lokal einrichten

In MeshCentral das vorhandene Konto `mcp-service` benutzen. Es braucht Sichtbarkeit auf die gewünschten Geräte und für Befehle die Berechtigung **Befehle/Remote Commands**. Kein MeshCentral-Server-Masterschlüssel wird benötigt. Verwendet wird die normale WebSocket-Anmeldung mit Benutzername/Passwort. Wenn dieses Konto zwingende MFA oder externe SSO-Anmeldung hat, kann dieser erste Adapter die Anmeldung nicht automatisch abschließen; die MFA nicht dafür abschalten. Dann ist eine Erweiterung auf den vom Server unterstützten kontoabhängigen Tokenzugang nötig.

Mit installiertem Node.js 22 oder neuer:

```bash
node src/setup.js
```

Alternativ ohne Node.js auf dem Host:

```bash
podman run --rm -it \
  --userns=keep-id --user "$(id -u):$(id -g)" \
  -v "$PWD:/work:Z" -w /work \
  docker.io/library/node:24-bookworm-slim node src/setup.js
```

Das Setup fragt URL, Benutzer und Geräte-ID ab. MeshCentral-Passwort und ein eigenes Brücken-Passwort (mindestens 16 Zeichen) werden verdeckt eingegeben. Das Brücken-Passwort aufbewahren: es wird später für die ChatGPT-Verbindung gebraucht. Kein Passwort in ChatGPT-Nachrichten einfügen. Das Setup überschreibt keine bestehenden Konfigurationen.

Die eingegebene ID von Beispielserver bitte beim ersten Aufruf von `meshcentral_devices` bestätigen. Weitere Geräte später nur mit vollständigem `node/<domain>/<id>` in `allowedNodeIds` aufnehmen. Namen sind keine IDs. Gibt die Liste kein Gerät zurück, zuerst ID und MeshCentral-Rechte prüfen.

## 3. Podman-Secrets und Image

```bash
podman secret create meshcentral-mcp-password secrets/mesh-password
podman secret create meshcentral-mcp-owner secrets/owner-hash
podman volume create meshcentral-mcp-data
podman build -t localhost/meshcentral-mcp:0.1.0 -f Containerfile .
```

`secrets/` ist vom Containerbuild ausgeschlossen. Die Dateien sind lokal nur für ihren Besitzer lesbar. Nach der erfolgreichen Einrichtung verschlüsselt sichern oder geschützt verwahren. Bei schon existierenden Secrets bricht `secret create` ab; es überschreibt sie nicht.

## 4. Als Dienst starten

Für die mitgelieferte Quadlet-Datei muss `config.json` tatsächlich unter `/opt/meshcentral-mcp` liegen. Für einen anderen Ablageort `Volume=` anpassen.

```bash
mkdir -p ~/.config/containers/systemd
cp deploy/meshcentral-mcp.container ~/.config/containers/systemd/
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload
systemctl --user start meshcentral-mcp.service
systemctl --user status meshcentral-mcp.service
curl --fail http://127.0.0.1:8787/healthz
```

Erwartet: `{"status":"ok","version":"0.1.0"}`. `WantedBy=default.target` in der Quadlet-Datei aktiviert den Dienst beim Start der Benutzersitzung; kein zusätzliches `systemctl enable` verwenden. Der Container läuft als Benutzer `node`, ohne Host-Socket, ohne Host-Netz und mit schreibgeschütztem Image-Dateisystem. Nur OAuth-Clientmetadaten werden in das Datenvolume geschrieben.

```bash
journalctl --user -u meshcentral-mcp.service -n 50 --no-pager
```

## 5. HTTPS und Plesk

Zuerst klären: **Auf welchem Host läuft Plesk, auf welchem die Brücke?** Die mitgelieferte Proxy-Konfiguration gilt nur, wenn beide auf demselben Host laufen. Läuft Plesk auf einem anderen Server als Beispielserver, erreicht dessen `127.0.0.1` nicht Beispielserver. Dann entweder die Brücke auf dem Plesk-Host betreiben oder eine verschlüsselte private Verbindung zwischen beiden Hosts einrichten und den Proxy entsprechend anpassen. Port 8787 wird in der Vorlage ausschließlich lokal veröffentlicht.

Für Plesk und Brücke auf demselben Host:

1. Eigene Subdomain `mcp-mesh.example.com` anlegen; DNS auf diesen Host zeigen lassen.
2. Gültiges TLS-Zertifikat für diese Subdomain ausstellen, z. B. Let's Encrypt.
3. HTTPS-Weiterleitung aktivieren.
4. Bei dieser Subdomain unter **Apache & nginx-Einstellungen → Zusätzliche nginx-Anweisungen** den Inhalt aus `deploy/nginx-plesk.conf` einfügen und anwenden.
5. Die gezielten Pfadregeln vermeiden ein zusätzliches `location /`, das in Plesk mit bestehenden Regeln kollidieren kann. Vorhandene Regeln prüfen. Kein globales Plesk-Template ändern.
6. Kein Basic-Auth/Passwortschutz vor diese OAuth-Endpunkte setzen: die MCP-Authentifizierung läuft über OAuth.

```bash
curl --fail https://mcp-mesh.example.com/healthz
curl --fail https://mcp-mesh.example.com/.well-known/oauth-authorization-server
curl -i https://mcp-mesh.example.com/mcp
```

Die ersten beiden Aufrufe müssen JSON liefern. `/mcp` ohne OAuth-Token muss **401** mit `WWW-Authenticate` liefern. Wenn die eigene Subdomain anders heißt, `publicUrl` anpassen und Dienst neu starten. Die öffentlichen Anmelde-/MCP-Pfade dürfen nicht als statische Webseiten behandelt werden.

## 6. Persönliches Plugin in ChatGPT anlegen

ChatGPT im **Webbrowser** öffnen:

1. **Plugins → Plus → Eigenen MCP-Server hinzufügen**.
2. Name: `MeshCentral`.
3. Server-URL: `https://mcp-mesh.example.com/mcp`.
4. Authentifizierung: **OAuth**. Statische Client-ID/Client-Secret leer lassen, damit dynamische Clientregistrierung verwendet wird. Falls eine Auswahl angezeigt wird, **DCR** verwenden; dieser Server implementiert keine CIMD-Clientregistrierung.
5. Die Zugriffsprüfung lesen und **Als Plugin erstellen** auswählen.
6. Das persönliche Plugin installieren und verbinden. Auf der Anmeldeseite das separate **Brücken-Passwort** eingeben; den sichtbaren Client, die Rückleitung und den Berechtigungsumfang prüfen.
7. In einem neuen Work-Chat `@MeshCentral` auswählen.

Erste Anfrage:

> Zeige mit MeshCentral alle freigegebenen Geräte und prüfe den Status von Beispielserver.

Damit ist das erste Setup ausschließlich lesend getestet.

## 7. Befehle aktivieren

Wenn die Geräteübersicht funktioniert, in `config.json` `"enableCommands": false` auf `true` ändern:

```bash
nano /opt/meshcentral-mcp/config.json
systemctl --user restart meshcentral-mcp.service
```

Anschließend in ChatGPT die Werkzeuge der Verbindung aktualisieren und OAuth erneut verbinden. Die Freigabe muss jetzt `mesh:execute` einschließen. Alte Tokens verfallen durch den Neustart. Nach erfolgreicher Freigabe:

> Führe auf Beispielserver nur `hostname`, `whoami` und `uptime` aus. Frage anschließend die Auftragsrückmeldung ab.

Diese drei Befehle prüfen die Anbindung, ohne die Gerätekonfiguration zu ändern. Ausführung zunächst bewusst mit kurzen Befehlen testen. Lange Updates, Reboots und interaktive Installer müssen separat geplant werden; die Brücke besitzt keine garantierte Prozessabbruchfunktion.

## Weitere Geräte, Updates und Abschalten

Zusätzliche vollständige Geräte-IDs in `allowedNodeIds` eintragen und Dienst neu starten. Der MeshCentral-Benutzer muss für diese Geräte ebenfalls freigegeben sein.

Bei geändertem Quellcode oder Lockfile:

```bash
cd /opt/meshcentral-mcp
podman build -t localhost/meshcentral-mcp:0.1.0 -f Containerfile .
systemctl --user restart meshcentral-mcp.service
```

Anschließend Plugin-Werkzeuge aktualisieren und neu authentifizieren. Die lokale Bridge-Version aktualisiert sich nicht automatisch. Für Zugangsdatenwechsel Podman-Secrets gezielt ersetzen und den Container neu erzeugen; bestehende Secrets sind nicht live aktualisierbar. Keine Zugangsdaten in Logs oder Befehlszeilen schreiben.

```bash
systemctl --user stop meshcentral-mcp.service
```

Zum Deaktivieren über Neustarts hinweg die Quadlet-Datei aus `~/.config/containers/systemd/` herausnehmen und `systemctl --user daemon-reload` aufrufen. Datenvolume und Secrets werden dadurch nicht gelöscht.

## Validierung

```bash
npm ci --ignore-scripts
npm test
npm audit --omit=dev
```

Automatisiert geprüft: Konfigurationsgrenzen, OAuth-Passwortprüfung, Redirect-Prüfung, PKCE, einmalige Autorisierungscodes, Tokenrotation/Widerruf, MCP-Initialisierung/Werkzeugaufrufe, Scope-Prüfung, Gerätefreigaben, WebSocket-Rückmeldungszuordnung, parallele Auftragsgrenzen und fehlende automatische Wiederholung.

**MCP-Adapter, Containerbuild, Plesk-Proxy und Pluginverbindung müssen vor dem Produktivbetrieb in der jeweiligen Umgebung live getestet werden.**

## Quellen

- OpenAI: https://developers.openai.com/plugins/build/mcp-server
- Eigenen MCP-Server verbinden: https://developers.openai.com/api/docs/guides/custom-mcp-server
- MeshCentral MeshCtrl: https://docs.meshcentral.com/meshctrl/
- Protokollvorlage: https://github.com/Ylianst/MeshCentral/blob/master/meshctrl.js
- Agent-Befehlsrückmeldungen: https://github.com/Ylianst/MeshCentral/blob/master/agents/meshcore.js
- Podman Quadlet: https://docs.podman.io/en/stable/markdown/podman-systemd.unit.5.html
- Plesk nginx-Regeln: https://support.plesk.com/hc/en-us/articles/12377110016151-Can-t-add-location-to-additional-nginx-directives-in-Plesk-nginx-emerg-duplicate-location

Eigenständige Integration, kein offizielles MeshCentral- oder OpenAI-Plugin. Quellenstand: 12.10.2026.
