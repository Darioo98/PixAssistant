# Pix

Barra multifunzione per Windows 10/11 con **Pix**, la mascotte a forma di piastrella.
Vive sul bordo destro dello schermo: passa il mouse sulla barra e diventa Pix, cliccalo
(o premi `Ctrl+Alt+Spazio`) e si apre il pannello con scadenze, password, chat con
Claude, note e to-do, timer e promemoria, cronologia appunti, link rapidi, meteo e
il turno in sede.

## Installazione

**[Scarica l'installer (Pix Setup 0.1.0)](https://github.com/Darioo98/PixAssistant/releases/latest)**
dalla pagina *Releases* del progetto.

1. Avvia `Pix-Setup-0.1.0.exe`. L'installer non è firmato: se Windows SmartScreen
   avvisa, scegli **Ulteriori informazioni → Esegui comunque**.
2. Scegli la cartella (predefinita: solo per il tuo utente, senza diritti di amministratore).
3. Pix parte da solo a fine installazione e, d'ora in poi, all'accesso a Windows
   (si disattiva in **Impostazioni → Avvio**).

Requisiti: Windows 10 o 11 a 64 bit. Per la chat serve **Claude Code** installato
e collegato al tuo abbonamento Claude (vedi sotto). Non serve installare .NET:
l'helper nativo lo include.

## Primo avvio

- **Cartella dati**: Pix usa una cartella `Pix` dentro OneDrive (preferisce il
  OneDrive personale; se c'è solo quello aziendale lo segnala). Si cambia in
  **Impostazioni → Backup e sincronizzazione → Cambia cartella dati**.
- **Cassaforte**: apri la scheda **Password** e premi **Configura**.
  1. Pix crea le chiavi e ti mostra **una sola volta** la **chiave di recupero**
     (8 gruppi da 4 caratteri). Conservala fuori dal PC: stampata o in un altro
     password manager. Per proseguire ti chiede di riscriverne l'ultimo gruppo.
  2. Attiva **Windows Hello** (volto, impronta o PIN) per aprire la cassaforte senza
     la chiave di recupero. Vale solo per quel PC.
- **Chat**: alla prima apertura della scheda **Chat AI** Pix verifica il collegamento
  a Claude. Se non hai fatto il login premi **Apri Claude Code**, digita `/login`,
  completa l'accesso nel browser e torna su **Verifica di nuovo**.

## Sicurezza in breve

- Le password sono cifrate con **AES-256-GCM** usando una *data key* casuale.
- Gli altri dati sincronizzati (scadenze, note, to-do, promemoria, chat, link,
  metadati delle password) sono cifrati con una seconda chiave, la *sync key*:
  si leggono anche a cassaforte chiusa, così i promemoria funzionano sempre.
- Su OneDrive (`keys.json`) le due chiavi sono cifrate **solo** con una chiave
  ricavata (scrypt) dalla chiave di recupero: nessuna chiave in chiaro, niente di
  legato a un singolo PC.
- Su ogni PC la sync key è protetta con DPAPI; la data key è cifrata con una chiave
  ricavata dalla firma di Windows Hello (la chiave privata sta nel TPM e firma solo
  dopo la verifica dell'utente).
- Dopo lo sblocco la cassaforte resta aperta 8 ore (configurabile) e si chiude
  subito se blocchi Windows, se il PC va in sospensione, o con **Blocca**.
- Le password copiate non entrano nella cronologia appunti (né in quella di Windows
  né in quella di Pix) e gli appunti si svuotano dopo 30 secondi.
- La chat usa Claude Code **senza strumenti**: niente accesso a file, comandi o
  Internet. Nessuna API key: si usa il tuo abbonamento.
- Dati inviati all'esterno: solo i messaggi della chat (a Claude), il nome della
  città (a Open-Meteo) e le richieste delle icone dei siti che aggiungi ai link.
- Le impostazioni condivise (lingua, tema, aspetto di Pix…) non sono cifrate:
  non contengono dati sensibili.

## Usare Pix su un secondo PC

1. Installa Pix e assicurati che OneDrive sincronizzi la stessa cartella.
2. Apri la scheda **Password**: Pix vede che la cassaforte esiste già e chiede la
   **chiave di recupero** per collegare il PC.
3. Attiva Windows Hello anche lì.

Finché il PC non è collegato, le scadenze e gli altri dati cifrati degli altri PC
non sono leggibili (e Pix non li sovrascrive).

## Recupero e backup

- **Windows Hello non funziona** (nuovo PIN, nuovo PC, TPM azzerato): nella scheda
  Password scegli **Usa la chiave di recupero**, poi riattiva Windows Hello.
- **Backup automatico**: ogni giorno in `%LOCALAPPDATA%\Pix\backups`, si tengono gli
  ultimi 7. Il file contiene i dati già cifrati e si apre solo con la chiave di recupero.
- **Esporta / Importa**: in **Impostazioni → Backup e sincronizzazione**. L'import
  *unisce* i dati a quelli attuali, non sovrascrive nulla; su un PC nuovo ripristina
  anche le chiavi.
- **Conflitti**: se due PC modificano la stessa voce, Pix tiene la versione più
  recente e conserva l'altra: la ritrovi in **Versioni in conflitto**, con
  **Ripristina** o **Ignora**.
- **Chiave di recupero persa**: finché hai Windows Hello attivo su almeno un PC puoi
  aprire la cassaforte ed esportare le password, ma senza la chiave di recupero non
  puoi collegare nuovi PC né aprire i backup. Conservala con cura.

## Dove sono i dati

| Cosa | Dove |
|---|---|
| Dati sincronizzati (cifrati) | `OneDrive\Pix\<collezione>\<id-PC>.json` (un file per PC) |
| Chiavi cifrate | `OneDrive\Pix\keys.json` |
| Sync key protetta, Windows Hello, cronologia appunti, timer, turno, log, backup | `%LOCALAPPDATA%\Pix` |

## Sviluppo

Requisiti: Node.js 22, .NET SDK 6 o successivo.

```
npm install
npm run native       # helper nativo (PixNative) per lo sviluppo
npm run dev          # avvia Pix in modalità sviluppo
npm test             # test unitari e di integrazione (Vitest)
npm run typecheck
npm run dist         # installer NSIS in dist\ (helper self-contained)
```

Per provare la build impacchettata senza registrare l'avvio automatico:
`set PIX_NO_AUTOSTART=1` prima di lanciare `dist\win-unpacked\Pix.exe`.

Struttura:

- `src/main` — processo principale: finestra, crittografia, dati, sincronizzazione,
  avvisi, AI (tutta la logica sensibile sta qui).
- `src/preload` — API minima esposta al renderer (`window.pix`).
- `src/renderer` — interfaccia React: Pix, pannello, schede.
- `src/shared` — tipi e logica pura condivisa (date, ricorrenze, unione dei dati…).
- `native/PixNative` — helper C# per Windows Hello, appunti protetti e stato schermo intero.
- `tests` — test Vitest.
