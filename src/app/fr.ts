// French. Each entry is keyed by the English text the code passes to t() or tn() (see i18n.ts); tests/unit/i18n.test.ts
// checks that none is missing or left over, and that both sides have the same {placeholders} and <markup>.

/** French typography: a non-breaking space before : ; ? ! % and inside « », so they never start a line. */
function spaced(dict: Record<string, string>): Record<string, string> {
  for (const k of Object.keys(dict)) {
    dict[k] = dict[k]
      .replace(/ ([;?!])/g, '\u202f$1')
      .replace(/ ([:%»])/g, '\u00a0$1')
      .replace(/« /g, '«\u00a0');
  }
  return dict;
}

export const FR: Record<string, string> = spaced({
  'You left the lesson': 'Vous avez quitté le cours',
  'Camera and microphone are off. The room stays open for the others.':
    'La caméra et le micro sont coupés. La salle reste ouverte pour les autres.',
  'Rejoin {code}': 'Revenir dans {code}',
  'New room': 'Nouvelle salle',
  'Something not right? Tell us': 'Un souci ? Dites-le-nous',
  Close: 'Fermer',
  'QR code of the room link': 'QR code du lien de la salle',
  Dismiss: 'Fermer',
  'Good connection': 'Bonne connexion',
  'Fair connection': 'Connexion moyenne',
  'Poor connection': 'Mauvaise connexion',
  Connection: 'Connexion',
  'Your browser is asking': 'Votre navigateur vous demande l’autorisation',
  'Allow notifications in its request, at the top of the window or behind the bell in the address bar.':
    'Autorisez les notifications dans sa demande, en haut de la fenêtre ou derrière la cloche dans la barre d’adresse.',
  'Notifications are blocked': 'Les notifications sont bloquées',
  'Allow them for this site from the icon at the left of the address bar, then come back.':
    'Autorisez-les pour ce site avec l’icône à gauche de la barre d’adresse, puis revenez.',
  'Link copied': 'Lien copié',
  'Send it to your teacher or student. They open it and they are in.':
    'Envoyez-le à votre élève ou à votre professeur : il suffit de l’ouvrir pour entrer.',
  'Could not copy': 'Copie impossible',
  'Sonora Live lesson': 'Cours Sonora Live',
  'Join my music lesson on Sonora Live (room {code}):':
    'Rejoignez mon cours de musique sur Sonora Live (salle {code}) :',
  'Invite to this lesson': 'Inviter à ce cours',
  'Room code': 'Code de la salle',
  'Room link': 'Lien de la salle',
  'Copy link': 'Copier le lien',
  'Share…': 'Partager…',
  'Who can join': 'Qui peut entrer',
  'Limit the room to {n} people': 'Limiter la salle à {n} personnes',
  'Anyone else with the link has to knock; someone inside can let them in.':
    'Toute autre personne ayant le lien doit frapper ; quelqu’un à l’intérieur peut la faire entrer.',
  'Anyone with the link or the code can join.': 'Toute personne ayant le lien ou le code peut entrer.',
  'Room size': 'Taille de la salle',
  '{n} person here now, everyone included': '{n} personne présente, vous compris',
  '{n} people here now, everyone included': '{n} personnes présentes, vous compris',
  'Allow one person fewer': 'Une personne de moins',
  'Allow one more person': 'Une personne de plus',
  'Everyone in the room can change this. Rooms are private by design: the code is only known to the people you send it to, and everything travels end-to-end encrypted.':
    'Tout le monde dans la salle peut modifier ce réglage. Les salles sont privées par nature : seules les personnes à qui vous envoyez le code le connaissent, et tout est chiffré de bout en bout.',
  'Sonora Live installed': 'Sonora Live est installé',
  'Open it from your home screen or apps.': 'Ouvrez-le depuis votre écran d’accueil ou vos applications.',
  'Add to Home Screen': 'Sur l’écran d’accueil',
  'Tap the Share button in Safari, then “Add to Home Screen”.':
    'Touchez le bouton Partager de Safari, puis « Sur l’écran d’accueil ».',
  'Room {code}. Share the room': 'Salle {code}. Partager la salle',
  Room: 'Salle',
  'Limited to {n} people': 'Limitée à {n} personnes',
  'Anyone with the link can join': 'Toute personne ayant le lien peut entrer',
  locked: 'verrouillée',
  open: 'ouverte',
  'Connection details': 'Détails de la connexion',
  relayed: 'relayée',
  'Sound is paused by the browser': 'Le navigateur a mis le son en pause',
  'One tap turns it on.': 'Une touche suffit à le rétablir.',
  'Turn on sound': 'Activer le son',
  "Can't reach the meeting point": 'Point de rencontre injoignable',
  'Check the internet connection. Retrying by itself; connected lessons continue.':
    'Vérifiez la connexion Internet. Nouvel essai automatique ; les cours déjà connectés continuent.',
  '{name} ({role}) is knocking': '{name} ({role}) frappe à la porte',
  'The room is limited to {n} people.': 'La salle est limitée à {n} personnes.',
  'Let in': 'Faire entrer',
  Ignore: 'Ignorer',
  'Joining {code}…': 'Connexion à {code}…',
  'Finding the others and opening a direct connection.': 'Recherche des autres et ouverture d’une connexion directe.',
  'A newer version is in use': 'Une version plus récente est utilisée',
  'The others use a newer Sonora Live. Reload to update, then join again.':
    'Les autres utilisent une version plus récente de Sonora Live. Rechargez pour mettre à jour, puis entrez à nouveau.',
  Reload: 'Recharger',
  'This lesson is full': 'Ce cours est complet',
  "The room is limited to {n} people. We let them know you're knocking: someone inside can let you in.":
    'La salle est limitée à {n} personnes. Nous les prévenons que vous frappez : quelqu’un à l’intérieur peut vous faire entrer.',
  'Waiting to be let in…': 'En attente d’admission…',
  'Start a new room instead': 'Créer plutôt une nouvelle salle',
  You: 'Vous',
  Voice: 'Voix',
  'Lesson controls': 'Commandes du cours',
  'Mute microphone': 'Couper le micro',
  'Unmute microphone': 'Rétablir le micro',
  Mute: 'Couper',
  Unmute: 'Rétablir',
  'Turn camera off': 'Couper la caméra',
  'Turn camera on': 'Activer la caméra',
  Camera: 'Caméra',
  'Sound mode': 'Mode de son',
  Pure: 'Pur',
  'MIDI instrument': 'Instrument MIDI',
  Keys: 'Clavier',
  Stop: 'Arrêter',
  Share: 'Partager',
  Flip: 'Inverser',
  React: 'Réagir',
  'React {emoji}': 'Réagir {emoji}',
  Chat: 'Discussion',
  Settings: 'Réglages',
  More: 'Plus',
  'Switch camera': 'Changer de caméra',
  Invite: 'Inviter',
  Leave: 'Quitter',
  'Leave the lesson': 'Quitter le cours',
  'Camera and microphone turn off.': 'La caméra et le micro se coupent.',
  Stay: 'Rester',
  Observer: 'Observateur',
  Guest: 'Invité',
  'Someone is knocking': 'Quelqu’un frappe à la porte',
  '{name} ({role}) wants to join your lesson.': '{name} ({role}) souhaite rejoindre votre cours.',
  '{name} joined': '{name} vient d’arriver',
  '{name} ({role}) joined the lesson': '{name} ({role}) a rejoint le cours',
  '{name} joined your lesson': '{name} a rejoint votre cours',
  '{name} left': '{name} a quitté la salle',
  'Lost connection to {name}': 'Connexion perdue avec {name}',
  'They can rejoin with the same link; it reconnects by itself.':
    'Le même lien permet de revenir ; la connexion se rétablit d’elle-même.',
  '{name} left the lesson': '{name} a quitté le cours',
  'Connection to {name} was lost': 'La connexion avec {name} a été perdue',
  'MIDI is off, so your microphone sends your instrument untouched again.':
    'Le MIDI est coupé : votre micro transmet de nouveau votre instrument tel quel.',
  '{name} connected': '{name} connecté',
  '{name} disconnected': '{name} déconnecté',
  'It reconnects by itself when it comes back.': 'La connexion se rétablit d’elle-même à son retour.',
  '{name} connected {device}': '{name} a connecté {device}',
  '{name} connected an instrument': '{name} a connecté un instrument',
  'Their playing now reaches you as MIDI.': 'Son jeu vous parvient désormais en MIDI.',
  Someone: 'Quelqu’un',
  'Room limited to {n} people': 'Salle limitée à {n} personnes',
  'Room unlocked': 'Salle déverrouillée',
  'Changed by {name}': 'Modifié par {name}',
  'Sent {file}': 'A envoyé {file}',
  'File too large': 'Fichier trop volumineux',
  'Files up to 50 MB can be shared in the chat.': 'La discussion permet de partager des fichiers jusqu’à 50 Mo.',
  'No camera found. You can join with sound only.': 'Aucune caméra trouvée. Vous pouvez entrer avec le son seulement.',
  'No microphone found.': 'Aucun micro trouvé.',
  'The camera is used by another app. Close it (Zoom, Teams, another tab), then try again.':
    'La caméra est utilisée par une autre application. Fermez-la (Zoom, Teams, un autre onglet), puis réessayez.',
  'The microphone is used by another app. Close it (Zoom, Teams, another tab), then try again.':
    'Le micro est utilisé par une autre application. Fermez-la (Zoom, Teams, un autre onglet), puis réessayez.',
  'Camera and microphone need a secure (https) page.': 'La caméra et le micro nécessitent une page sécurisée (https).',
  '{browser} cannot use a camera here. Try Chrome, Edge, Safari or Firefox.':
    '{browser} ne peut pas utiliser de caméra ici. Essayez Chrome, Edge, Safari ou Firefox.',
  '{browser} cannot use a microphone here. Try Chrome, Edge, Safari or Firefox.':
    '{browser} ne peut pas utiliser de micro ici. Essayez Chrome, Edge, Safari ou Firefox.',
  'The camera could not start.': 'La caméra n’a pas pu démarrer.',
  'The microphone could not start.': 'Le micro n’a pas pu démarrer.',
  'Sonora Live on GitHub': 'Sonora Live sur GitHub',
  'Install app': 'Installer l’app',
  'Source code on GitHub': 'Code source sur GitHub',
  'Music lessons,': 'Des cours de musique',
  'face to face': 'en face à face',
  ', from anywhere.': ', où que vous soyez.',
  "You're invited to a": 'On vous invite à un',
  lesson: 'cours',
  'Your instrument, heard as it really sounds. Two-way MIDI between pianos. Direct, private, no account and nothing to install.':
    'Votre instrument, entendu tel qu’il sonne vraiment. Le MIDI dans les deux sens, de piano à piano. Direct, privé, sans compte ni rien à installer.',
  'Starting camera…': 'Démarrage de la caméra…',
  'Camera is off': 'La caméra est coupée',
  'Too loud: lower the microphone level': 'Trop fort : baissez le niveau du micro',
  'Microphone level': 'Niveau du micro',
  'Too loud': 'Trop fort',
  Mic: 'Micro',
  'Show my preview unmirrored': 'Afficher mon aperçu sans effet miroir',
  'Mirror my preview': 'Afficher mon aperçu en miroir',
  'Mirror my preview (only for you). Turn it off for a camera pointed at the keys or a score.':
    'Aperçu en miroir (pour vous seulement). Désactivez-le pour une caméra pointée vers le clavier ou une partition.',
  Microphone: 'Micro',
  'Microphone {n}': 'Micro {n}',
  'Camera {n}': 'Caméra {n}',
  'Pure instrument sound': 'Le son pur de l’instrument',
  'Piano-to-piano MIDI': 'MIDI de piano à piano',
  'Game-grade low latency': 'Latence minimale, comme en jeu vidéo',
  'Peer to peer, encrypted': 'Pair à pair, chiffré',
  'Join the lesson': 'Rejoindre le cours',
  'Your room is ready': 'Votre salle est prête',
  'Joining room': 'Vous rejoignez la salle',
  'Room code {code}': 'Code de la salle {code}',
  'Your name': 'Votre nom',
  'e.g. Clara': 'ex. Clara',
  'Enter the room': 'Entrer dans la salle',
  'Headphones give the purest sound, wired if you can (Bluetooth adds delay). On speakers, the echo is cancelled.':
    'Un casque donne le son le plus pur, filaire si possible (le Bluetooth ajoute du retard). Sur haut-parleurs, l’écho est annulé.',
  Use: 'OK',
  'Have a code? Join another room': 'Vous avez un code ? Rejoindre une autre salle',
  'No account. No server sees your lesson.': 'Sans compte. Aucun serveur ne voit votre cours.',
  'How it works': 'Fonctionnement',
  Privacy: 'Confidentialité',
  'Camera off': 'Caméra coupée',
  'Connecting…': 'Connexion…',
  '{name} plays over MIDI': '{name} joue en MIDI',
  'Pure · stereo': 'Pur · stéréo',
  'Estimated delay of the sound from {name}': 'Retard estimé du son de {name}',
  'second camera': 'deuxième caméra',
  screen: 'écran',
  'Microphone off': 'Micro coupé',
  'Reconnecting…': 'Reconnexion…',
  'Connecting to a new participant…': 'Connexion à un nouveau participant…',
  'Connecting to {name}…': 'Connexion à {name}…',
  "You're in. Waiting for others…": 'Vous êtes dans la salle. En attente des autres…',
  'Scan to join': 'Scannez pour entrer',
  sent: 'envoyé',
  'tap to open': 'touchez pour ouvrir',
  incomplete: 'incomplet',
  '{n} person': '{n} personne',
  '{n} people': '{n} personnes',
  'Messages and files go straight to the others and disappear when the lesson ends.':
    'Messages et fichiers vont directement aux autres et disparaissent à la fin du cours.',
  'Drop sheet music (PDF, images, MusicXML) here to share it.':
    'Déposez ici une partition (PDF, images, MusicXML) pour la partager.',
  '{names} is typing': '{names} écrit',
  '{names} are typing': '{names} écrivent',
  'Attach a file': 'Joindre un fichier',
  Message: 'Message',
  Emoji: 'Émoji',
  Send: 'Envoyer',
  'Drop to share with everyone': 'Déposez pour partager avec tout le monde',
  "Don't see your instrument?": 'Votre instrument n’apparaît pas ?',
  '<b>Bluetooth piano on Windows?</b> Windows usually keeps Bluetooth MIDI instruments away from browsers (its new MIDI system is still rolling out). Install <a>Perfect Bluetooth MIDI for Windows</a> (free): it connects your piano and shows it here like a USB instrument, or use <b>Connect a Bluetooth instrument</b> above, which works without it in Chrome and Edge.':
    '<b>Piano Bluetooth sous Windows ?</b> Windows tient en général les instruments MIDI Bluetooth à l’écart des navigateurs (son nouveau système MIDI est encore en cours de déploiement). Installez <a>Perfect Bluetooth MIDI for Windows</a> (gratuit) : il connecte votre piano et le fait apparaître ici comme un instrument USB. Vous pouvez aussi utiliser <b>Connecter un instrument Bluetooth</b> ci-dessus, qui s’en passe dans Chrome et Edge.',
  '<b>Bluetooth piano on Windows?</b> Windows usually keeps Bluetooth MIDI instruments away from browsers (its new MIDI system is still rolling out). Install <a>Perfect Bluetooth MIDI for Windows</a> (free): it connects your piano and shows it here like a USB instrument.':
    '<b>Piano Bluetooth sous Windows ?</b> Windows tient en général les instruments MIDI Bluetooth à l’écart des navigateurs (son nouveau système MIDI est encore en cours de déploiement). Installez <a>Perfect Bluetooth MIDI for Windows</a> (gratuit) : il connecte votre piano et le fait apparaître ici comme un instrument USB.',
  '<b>USB:</b> plug the cable in, then tap <b>Refresh</b>. Close other music apps first: on Windows an instrument can be used by one app at a time.':
    '<b>USB :</b> branchez le câble, puis touchez <b>Actualiser</b>. Fermez d’abord les autres applications musicales : sous Windows, un instrument ne peut servir qu’à une application à la fois.',
  '<b>USB:</b> plug it in and tap <b>Refresh</b>.': '<b>USB :</b> branchez-le et touchez <b>Actualiser</b>.',
  '<b>Bluetooth:</b> use <b>Connect a Bluetooth instrument</b> above, or pair it in Audio MIDI Setup → Window → Show MIDI Studio → Bluetooth.':
    '<b>Bluetooth :</b> utilisez <b>Connecter un instrument Bluetooth</b> ci-dessus, ou jumelez-le dans Configuration audio et MIDI → Fenêtre → Afficher le studio MIDI → Bluetooth.',
  '<b>Bluetooth:</b> pair it in Audio MIDI Setup → Window → Show MIDI Studio → Bluetooth, then tap Refresh.':
    '<b>Bluetooth :</b> jumelez-le dans Configuration audio et MIDI → Fenêtre → Afficher le studio MIDI → Bluetooth, puis touchez Actualiser.',
  'Safari has no MIDI support: open this room in Chrome, Edge or Firefox to use your instrument.':
    'Safari ne gère pas le MIDI : ouvrez cette salle dans Chrome, Edge ou Firefox pour utiliser votre instrument.',
  '<b>USB:</b> connect the instrument with a USB OTG adapter (USB-C to USB-B for most pianos), then tap <b>Refresh</b>.':
    '<b>USB :</b> branchez l’instrument avec un adaptateur USB OTG (USB-C vers USB-B pour la plupart des pianos), puis touchez <b>Actualiser</b>.',
  '<b>Bluetooth:</b> turn Bluetooth and location on, then use <b>Connect a Bluetooth instrument</b>.':
    '<b>Bluetooth :</b> activez le Bluetooth et la localisation, puis utilisez <b>Connecter un instrument Bluetooth</b>.',
  '<b>Bluetooth:</b> pair it with your system (bluetoothctl, BlueZ with MIDI support), or enable Web Bluetooth in Chrome at <code>chrome://flags/#enable-experimental-web-platform-features</code>.':
    '<b>Bluetooth :</b> jumelez-le avec votre système (bluetoothctl, BlueZ avec la prise en charge du MIDI), ou activez Web Bluetooth dans Chrome à l’adresse <code>chrome://flags/#enable-experimental-web-platform-features</code>.',
  'USB instruments appear when plugged in; Bluetooth ones with <b>Connect a Bluetooth instrument</b>.':
    'Les instruments USB apparaissent dès qu’ils sont branchés ; les instruments Bluetooth avec <b>Connecter un instrument Bluetooth</b>.',
  'Still nothing? Turn the instrument off and on, try another cable or port, and check that it is not connected to another device (a phone app, for example).':
    'Toujours rien ? Éteignez et rallumez l’instrument, essayez un autre câble ou un autre port, et vérifiez qu’il n’est pas connecté à un autre appareil (une application de téléphone, par exemple).',
  "iPhone and iPad browsers cannot reach MIDI instruments yet (Apple's WebKit has no Web MIDI), whatever the cable. Two free apps open this same room with MIDI:":
    'Les navigateurs de l’iPhone et de l’iPad n’accèdent pas encore aux instruments MIDI (le WebKit d’Apple n’a pas Web MIDI), quel que soit le câble. Deux applications gratuites ouvrent cette même salle avec le MIDI :',
  '<a>Web MIDI Browser</a> for USB and Bluetooth instruments;':
    '<a>Web MIDI Browser</a> pour les instruments USB et Bluetooth ;',
  '<a>Bluefy</a> for Bluetooth instruments.': '<a>Bluefy</a> pour les instruments Bluetooth.',
  'Without them, you still see and hear everything the other side plays, on the built-in piano.':
    'Sans elles, vous voyez et entendez quand même tout ce que joue l’autre côté, sur le piano intégré.',
  'Play together with MIDI': 'Jouer ensemble en MIDI',
  "Connect your digital piano: what you play sounds on the other side's instrument (or the built-in piano), and theirs on yours, at full quality and without going through the microphone.":
    'Connectez votre piano numérique : ce que vous jouez sonne sur l’instrument de l’autre côté (ou sur le piano intégré), et inversement, en pleine qualité et sans passer par le micro.',
  '{browser} cannot connect to MIDI instruments. Open this room in Chrome, Edge or Firefox to use yours. You still hear and see what the others play.':
    '{browser} ne peut pas se connecter aux instruments MIDI. Ouvrez cette salle dans Chrome, Edge ou Firefox pour utiliser le vôtre. Vous voyez et entendez quand même ce que jouent les autres.',
  'Your instrument': 'Votre instrument',
  "Allow MIDI access in the browser's prompt…": 'Autorisez l’accès MIDI dans la demande du navigateur…',
  'MIDI access was blocked. Allow it from the icon in the address bar (site settings → MIDI devices), then tap Refresh.':
    'L’accès MIDI a été bloqué. Autorisez-le avec l’icône de la barre d’adresse (paramètres du site → appareils MIDI), puis touchez Actualiser.',
  'MIDI instruments': 'Instruments MIDI',
  'Connected · receiving notes': 'Connecté · notes reçues',
  'Connected · play a few notes to check': 'Connecté · jouez quelques notes pour vérifier',
  'Selected · not connected': 'Sélectionné · non connecté',
  'plays & sounds': 'émet et joue des notes',
  plays: 'émet des notes',
  sounds: 'joue des notes',
  'MIDI port': 'Port MIDI',
  'No instrument found yet. Plug it in (or turn it on), then tap Refresh.':
    'Aucun instrument trouvé pour l’instant. Branchez-le (ou allumez-le), puis touchez Actualiser.',
  'Connect a Bluetooth instrument': 'Connecter un instrument Bluetooth',
  Refresh: 'Actualiser',
  "The others' playing sounds on": 'Le jeu des autres sonne sur',
  "Where the others' notes sound": 'Où sonnent les notes des autres',
  'My instrument': 'Mon instrument',
  'Built-in piano': 'Piano intégré',
  Off: 'Coupé',
  'Test: play C–E–G on my instrument': 'Test : jouer do–mi–sol sur mon instrument',
  'MIDI channel': 'Canal MIDI',
  'Channel: as played': 'Canal : tel que joué',
  'Channel {n}': 'Canal {n}',
  'No instrument output connected: the built-in piano plays meanwhile.':
    'Aucune sortie d’instrument connectée : le piano intégré joue en attendant.',
  'Piano volume': 'Volume du piano',
  'Built-in piano volume': 'Volume du piano intégré',
  'Loading the concert grand · {pct}%': 'Chargement du piano de concert · {pct} %',
  'A Steinway concert grand, four velocity layers, real dampers and pedals. Plays through your speakers or headphones.':
    'Un grand Steinway de concert, quatre couches de vélocité, de vrais étouffoirs et pédales. Joue sur vos haut-parleurs ou votre casque.',
  Options: 'Options',
  'Send my playing to the others': 'Envoyer mon jeu aux autres',
  'Your notes and pedals reach their instrument or built-in piano.':
    'Vos notes et vos pédales parviennent à leur instrument ou à leur piano intégré.',
  'When an instrument is connected.': 'Quand un instrument est connecté.',
  'Show the piano keys': 'Afficher le clavier',
  "Everyone's notes light up in their colour; click or touch to play.":
    'Les notes de chacun s’allument dans sa couleur ; cliquez ou touchez pour jouer.',
  'Concert hall reverb': 'Réverbération de salle de concert',
  'A touch of room around the built-in piano.': 'Un peu d’espace autour du piano intégré.',
  'In this lesson': 'Dans ce cours',
  'Plays {device} over MIDI': 'Joue sur {device} en MIDI',
  'Plays an instrument over MIDI': 'Joue sur un instrument en MIDI',
  '{device} connected, not sending': '{device} connecté, sans envoi',
  'No MIDI instrument': 'Pas d’instrument MIDI',
  'hears your MIDI': 'entend votre MIDI',
  'MIDI sound off': 'son MIDI coupé',
  'With sound mode on Auto, your microphone switches to voice mode while your piano travels as MIDI: talking stays clear and the piano is not sent twice.':
    'Avec le mode de son sur Auto, votre micro passe en mode voix pendant que votre piano transite en MIDI : la parole reste claire et le piano n’est pas envoyé deux fois.',
  'This room': 'Cette salle',
  'Limit to {n} people': 'Limiter à {n} personnes',
  'Others have to knock; someone inside can let them in. Change the size from the lock in the top bar.':
    'Les autres doivent frapper ; quelqu’un à l’intérieur peut les faire entrer. Modifiez la taille avec le cadenas de la barre du haut.',
  Notifications: 'Notifications',
  'Notify me when someone joins': 'Me prévenir quand quelqu’un arrive',
  'A system notification when this tab is in the background, plus a chime.':
    'Une notification du système quand cet onglet est en arrière-plan, et un carillon.',
  'Blocked in this browser: allow notifications for this site from the icon at the left of the address bar. A chime still plays.':
    'Bloquées dans ce navigateur : autorisez les notifications pour ce site avec l’icône à gauche de la barre d’adresse. Le carillon sonne quand même.',
  'Not available in this browser (on iPhone and iPad: install the app first). A chime still plays.':
    'Indisponibles dans ce navigateur (sur iPhone et iPad : installez d’abord l’app). Le carillon sonne quand même.',
  'Your browser asks for permission first. Without it, a chime still plays.':
    'Votre navigateur demande d’abord l’autorisation. Sans elle, le carillon sonne quand même.',
  'Allow notifications': 'Autoriser les notifications',
  Sound: 'Son',
  Video: 'Vidéo',
  General: 'Général',
  Standard: 'Standard',
  High: 'Haute',
  Studio: 'Studio',
  '96 kbps · slow or mobile connections': '96 kbit/s · connexions lentes ou mobiles',
  '192 kbps stereo · recommended': '192 kbit/s stéréo · recommandé',
  '320 kbps stereo · broadcast quality': '320 kbit/s stéréo · qualité diffusion',
  'Data saver · 360p': 'Économie de données · 360p',
  'HD · 720p': 'HD · 720p',
  'Full HD · 1080p': 'Full HD · 1080p',
  Auto: 'Auto',
  'No noise suppression, no automatic volume, stereo when your microphone has it: every sustain, pedal and pianissimo arrives as played.':
    'Ni réduction de bruit, ni volume automatique, et la stéréo si votre micro la permet : chaque tenue, chaque pédale et chaque pianissimo arrive tel que joué.',
  "The browser's speech processing: removes background noise and echo, and part of the music with it.":
    'Le traitement de la parole du navigateur : il supprime le bruit de fond et l’écho, et une partie de la musique avec.',
  'Echo cancelling': 'Annulation d’écho',
  '{name} turned on music-safe echo cancelling on your microphone':
    '{name} a activé l’annulation d’écho préservant la musique sur votre micro',
  '{name} turned off music-safe echo cancelling on your microphone':
    '{name} a désactivé l’annulation d’écho préservant la musique sur votre micro',
  '{name} turned on the automatic level of your microphone': '{name} a activé le niveau automatique de votre micro',
  '{name} turned off the automatic level of your microphone': '{name} a désactivé le niveau automatique de votre micro',
  '{name} turned off the others’ MIDI notes on your side': '{name} a coupé les notes MIDI des autres chez vous',
  '{name} turned on the others’ MIDI notes on your side': '{name} a activé les notes MIDI des autres chez vous',
  '{name} turned on sending your MIDI': '{name} a activé l’envoi de votre MIDI',
  '{name} turned off sending your MIDI': '{name} a coupé l’envoi de votre MIDI',
  'You can change it back in the Sound tab.': 'Vous pouvez revenir en arrière dans l’onglet Son.',
  muted: 'micro coupé',
  headphones: 'casque',
  'While the piano plays through MIDI, the microphone carries the voice only (the piano is not heard twice).':
    'Quand le piano passe en MIDI, le micro ne transmet que la voix (le piano n’est pas entendu deux fois).',
  'Music-safe': 'Préserve la musique',
  'Brings a quiet microphone up slowly, from the loudest moments, and keeps a forte from clipping: a crescendo stays a crescendo.':
    'Remonte doucement un micro trop faible, d’après les moments les plus forts, et empêche un forte de saturer : un crescendo reste un crescendo.',
  'Send MIDI': 'Envoyer le MIDI',
  'Notes and pedals played on the instrument reach the others.':
    'Les notes et les pédales jouées sur l’instrument arrivent aux autres.',
  'Where the others’ MIDI notes sound on this side: Auto (the instrument if one can play them, else the built-in piano), the built-in piano, the instrument, or not at all (then only what the microphone carries is heard).':
    'Où sonnent ici les notes MIDI des autres : Auto (l’instrument s’il peut les jouer, sinon le piano intégré), le piano intégré, l’instrument, ou nulle part (on n’entend alors que ce que transmet le micro).',
  Piano: 'Piano',
  'The built-in piano': 'Le piano intégré',
  'Instr.': 'Instr.',
  'The instrument connected here': 'L’instrument branché ici',
  'Clean noise (for me)': 'Retirer le bruit (pour moi)',
  'Takes the steady background noise (hiss, a fan) out of what you hear from them, for you only. Adds 8 ms.':
    'Retire le bruit de fond constant (souffle, ventilateur) de ce que vous entendez de cette personne, pour vous seulement. Ajoute 8 ms.',
  'Their sound: when it leaves their side, then your buffer; their MIDI waits that long when in time.':
    'Son son : le temps avant qu’il parte de chez elle, puis votre tampon ; son MIDI attend autant quand il est synchronisé.',
  'Changes to someone else’s settings are made on their device, and they are told.':
    'Les changements des réglages de quelqu’un d’autre se font sur son appareil, et il en est informé.',
  'Automatic level': 'Niveau automatique',
  'Brings a quiet microphone up slowly, from your loudest moments, and keeps a forte from clipping: a crescendo stays a crescendo.':
    'Remonte doucement un micro trop faible, d’après vos moments les plus forts, et empêche un forte de saturer : un crescendo reste un crescendo.',
  'Now: {db} dB.': 'Actuellement : {db} dB.',
  'Your microphone exactly as it comes: set its level in your system’s sound settings.':
    'Votre micro tel quel : réglez son niveau dans les réglages son de votre système.',
  'The sound of your speakers is taken out of your microphone: the others never hear themselves.':
    'Le son de vos haut-parleurs est retiré de votre micro : les autres ne s’entendent jamais eux-mêmes.',
  'the browser’s': 'celle du navigateur',
  'Microphone: voice only': 'Micro : voix seulement',
  'Microphone: instrument and voice': 'Micro : instrument et voix',
  'Your piano now reaches the others as MIDI, so your microphone carries your voice only. To send your piano’s sound through it too: MIDI panel, “Voice only on my microphone while I play through MIDI”.':
    'Votre piano arrive maintenant aux autres en MIDI : votre micro ne transmet plus que votre voix. Pour y faire aussi passer le son de votre piano : panneau MIDI, « Voix seulement sur mon micro quand je joue en MIDI ».',
  '{name} set your microphone to voice only': '{name} a réglé votre micro sur voix seulement',
  '{name} set your microphone to voice only while your piano plays through MIDI':
    '{name} a réglé votre micro sur voix seulement quand votre piano passe en MIDI',
  '{name} set your microphone to instrument and voice': '{name} a réglé votre micro sur instrument et voix',
  '{name} turned off echo cancelling on your microphone': '{name} a désactivé l’annulation d’écho de votre micro',
  '{name} turned on echo cancelling on your microphone': '{name} a activé l’annulation d’écho de votre micro',
  'Voice only on my microphone while I play through MIDI': 'Voix seulement sur mon micro quand je joue en MIDI',
  'Your piano reaches the others as MIDI, so your microphone is tuned for speech. Turn off to also send your piano’s sound through the microphone.':
    'Votre piano arrive aux autres en MIDI : votre micro est réglé pour la parole. Désactivez pour faire aussi passer le son de votre piano par le micro.',
  'Your piano’s sound also goes through your microphone, as well as through MIDI.':
    'Le son de votre piano passe aussi par votre micro, en plus du MIDI.',
  'Sound from {name}': 'Le son de {name}',
  'You hear it, so you can tell what it needs. Changes to their microphone are made on their device, and they are told.':
    'C’est vous qui l’entendez : vous savez ce qu’il lui faut. Les changements de son micro se font sur son appareil, et il en est informé.',
  'Their microphone': 'Son micro',
  'Instrument and voice': 'Instrument et voix',
  'Voice only': 'Voix seulement',
  'Voice only while their piano plays through MIDI': 'Voix seulement quand son piano passe en MIDI',
  'Now: their piano reaches you as MIDI, their microphone carries their voice only.':
    'Actuellement : son piano vous arrive en MIDI, son micro ne transmet que sa voix.',
  'Now: their piano reaches you as MIDI and through their microphone.':
    'Actuellement : son piano vous arrive en MIDI et par son micro.',
  'Their piano does not play through MIDI now.': 'Son piano ne passe pas en MIDI en ce moment.',
  'Echo cancelling on their side': 'Annulation d’écho de son côté',
  'Now: on. You do not hear yourself back from their speakers.':
    'Actuellement : activée. Vous ne vous entendez pas revenir par ses haut-parleurs.',
  'Now: off, they wear headphones.': 'Actuellement : désactivée, il porte un casque.',
  'Now: off. If you hear yourself back, turn it on.':
    'Actuellement : désactivée. Si vous vous entendez en retour, activez-la.',
  'For what you hear only: hiss, a fan, air conditioning are taken out; their instrument and voice stay as they are. Adds 8 ms.':
    'Pour ce que vous entendez seulement : souffle, ventilateur, climatisation sont retirés ; son instrument et sa voix restent intacts. Ajoute 8 ms.',
  'As an observer, you can only change what you hear.':
    'En tant qu’observateur, vous ne pouvez changer que ce que vous entendez.',
  '{name} uses an older version: reload it to change their microphone from here.':
    '{name} utilise une ancienne version : qu’il recharge la page pour que vous puissiez régler son micro d’ici.',
  'voice only': 'voix seulement',
  'Your microphone': 'Votre micro',
  'What the others hear from you. They can change it too, since they hear it.':
    'Ce que les autres entendent de vous. Ils peuvent le changer aussi, puisque ce sont eux qui l’entendent.',
  'Voice only while my piano plays through MIDI': 'Voix seulement quand mon piano passe en MIDI',
  'Now: your piano reaches the others as MIDI, so your microphone carries your voice only. Turn off to also send your piano’s sound through the microphone.':
    'Actuellement : votre piano arrive aux autres en MIDI, votre micro ne transmet que votre voix. Désactivez pour faire aussi passer le son de votre piano par le micro.',
  'Now: your piano reaches the others as MIDI and through your microphone.':
    'Actuellement : votre piano arrive aux autres en MIDI et par votre micro.',
  'When your piano reaches the others as MIDI, your microphone is tuned for speech. Turn off to keep sending your piano’s sound through the microphone too.':
    'Quand votre piano arrive aux autres en MIDI, votre micro est réglé pour la parole. Désactivez pour continuer à faire passer le son de votre piano par le micro.',
  'Background noise': 'Bruit de fond',
  'Whoever hears it removes it: tap the sound label on someone’s picture to clean the steady noise (hiss, a fan) from what you hear from them.':
    'C’est celui qui l’entend qui le retire : touchez l’étiquette du son sur l’image de quelqu’un pour retirer le bruit constant (souffle, ventilateur) de ce que vous entendez de lui.',
  'Noise reduction (what you hear)': 'Réduction du bruit (ce que vous entendez)',
  'Sound from {name}: what you hear, and how to clean it':
    'Le son de {name} : ce que vous entendez, et comment le nettoyer',
  'Echo cancelled': 'Écho annulé',
  off: 'désactivé',
  on: 'activé',
  'Browser processing': 'Traitement du navigateur',
  echo: 'écho',
  noise: 'bruit',
  volume: 'volume',
  'not available in this browser': 'non disponible dans ce navigateur',
  running: 'en marche',
  '{db} dB removed': '{db} dB retirés',
  Output: 'Sortie',
  'Sound check': 'Vérification du son',
  'Report copied': 'Rapport copié',
  'Copy report': 'Copier le rapport',
  On: 'Activée',
  'Off (headphones)': 'Désactivée (casque)',
  'Echo cancelling is off: wear headphones, or the others will hear themselves.':
    'L’annulation d’écho est désactivée : portez un casque, sinon les autres s’entendront eux-mêmes.',
  Quality: 'Qualité',
  'Audio quality': 'Qualité audio',
  '{quality}. Opus codec, 10 ms frames, no silence suppression.':
    '{quality}. Codec Opus, trames de 10 ms, sans suppression des silences.',
  'Stereo input': 'Entrée stéréo',
  'Mono input': 'Entrée mono',
  "Your microphone is overloaded (it clips on loud passages). Lower its input level in your system's sound settings, or move it a little further from the instrument.":
    'Votre micro sature (il écrête sur les passages forts). Baissez son niveau d’entrée dans les réglages audio du système, ou éloignez-le un peu de l’instrument.',
  'Speakers or headphones': 'Haut-parleurs ou casque',
  Speakers: 'Haut-parleurs',
  'Output {n}': 'Sortie {n}',
  Test: 'Tester',
  'Join and message sounds': 'Sons d’arrivée et de message',
  'A soft chime when someone joins, leaves or writes.': 'Un léger carillon quand quelqu’un arrive, part ou écrit.',
  'Video quality': 'Qualité vidéo',
  '{quality}. Smooth motion is kept first, so hands stay fluid.':
    '{quality}. La fluidité passe en premier : les mains restent nettes en mouvement.',
  'Second camera': 'Deuxième caméra',
  'Show the keys from above (or your hands) next to your face. The others see both.':
    'Montrez le clavier vu de dessus (ou vos mains) à côté de votre visage. Les autres voient les deux.',
  'Stop second camera': 'Arrêter la deuxième caméra',
  'Choose a camera…': 'Choisir une caméra…',
  Add: 'Ajouter',
  "Or join from a phone with the room's QR code, as an Observer, and point it at the keyboard.":
    'Ou rejoignez la salle depuis un téléphone avec son QR code, en tant qu’Observateur, et pointez-le vers le clavier.',
  'Only for you: the others always see the real image.':
    'Pour vous seulement : les autres voient toujours l’image réelle.',
  'Start with the camera off': 'Démarrer avec la caméra coupée',
  'Meeting point': 'Point de rencontre',
  '{up}/{total} rendezvous servers reachable. They only pass the encrypted handshake; the lesson itself flows directly between you.':
    '{up}/{total} serveurs de rendez-vous joignables. Ils ne font que transmettre la prise de contact chiffrée ; le cours lui-même passe directement entre vous.',
  'Connection details appear here once someone joins.':
    'Les détails de la connexion apparaissent ici dès que quelqu’un arrive.',
  'Measuring…': 'Mesure en cours…',
  Path: 'Chemin',
  'Network round trip': 'Aller-retour réseau',
  'Their sound reaches you in (est.)': 'Son de l’autre côté reçu en (est.)',
  'Jitter buffer': 'Tampon de gigue',
  'Audio in / out': 'Audio entrant / sortant',
  'Audio codec': 'Codec audio',
  stereo: 'stéréo',
  mono: 'mono',
  '{n} ms frames': 'trames de {n} ms',
  'Audio packet loss': 'Perte de paquets audio',
  'Video in': 'Vidéo entrante',
  'Video out': 'Vidéo sortante',
  'Strict network? Add a TURN relay': 'Réseau strict ? Ajoutez un relais TURN',
  'Most connections are direct. A few networks (some offices, schools, mobile carriers) block that; a TURN relay gets through. This site already has one configured; you can add your own.':
    'La plupart des connexions sont directes. Quelques réseaux (certains bureaux, écoles, opérateurs mobiles) les bloquent ; un relais TURN passe au travers. Ce site en a déjà un ; vous pouvez ajouter le vôtre.',
  'Most connections are direct. A few networks (some offices, schools, mobile carriers) block that; a TURN relay gets through. You can use your own, for example a free Metered account or your own coturn server.':
    'La plupart des connexions sont directes. Quelques réseaux (certains bureaux, écoles, opérateurs mobiles) les bloquent ; un relais TURN passe au travers. Vous pouvez utiliser le vôtre, par exemple un compte Metered gratuit ou votre propre serveur coturn.',
  Username: 'Nom d’utilisateur',
  'TURN username': 'Nom d’utilisateur TURN',
  Credential: 'Mot de passe',
  'TURN credential': 'Mot de passe TURN',
  'Save (used for new connections)': 'Enregistrer (pour les nouvelles connexions)',
  Language: 'Langue',
  Automatic: 'Automatique',
  'The language of this browser': 'La langue de ce navigateur',
  'Following this browser: {language}.': 'Selon ce navigateur : {language}.',
  'Remote music lessons that sound like the room. Peer-to-peer video, pure instrument sound and two-way MIDI, in the browser. Free and open source (MIT).':
    'Des cours de musique à distance qui sonnent comme dans la pièce. Vidéo de pair à pair, son pur de l’instrument et MIDI dans les deux sens, dans le navigateur. Gratuit et open source (MIT).',
  'Version {version}': 'Version {version}',
  'Source on GitHub': 'Code source sur GitHub',
  'No account, no server in the middle, no recording. Audio, video, chat, files and MIDI travel directly between the browsers, encrypted (DTLS-SRTP). The short handshake that lets you find each other passes through public rendezvous servers, encrypted with a key made from the room code. Your preferences stay in this browser.':
    'Pas de compte, pas de serveur intermédiaire, pas d’enregistrement. Audio, vidéo, discussion, fichiers et MIDI circulent directement entre les navigateurs, chiffrés (DTLS-SRTP). La courte prise de contact qui vous permet de vous trouver passe par des serveurs de rendez-vous publics, chiffrée avec une clé tirée du code de la salle. Vos préférences restent dans ce navigateur.',
  Credits: 'Crédits',
  'Built-in piano: the Splendid Grand Piano (Steinway, public domain samples by Akai, remastered by the SFZ Instruments project) · Fonts: Instrument Serif and Instrument Sans (SIL Open Font License) · Emoji picker: emoji-picker-element · Icons: Lucide':
    'Piano intégré : le Splendid Grand Piano (Steinway, échantillons du domaine public par Akai, remasterisés par le projet SFZ Instruments) · Polices : Instrument Serif et Instrument Sans (SIL Open Font License) · Sélecteur d’émojis : emoji-picker-element · Icônes : Lucide',
  'all credits': 'tous les crédits',
  'limited by the processor': 'limité par le processeur',
  'limited by the network': 'limité par le réseau',
  'limited ({reason})': 'limité ({reason})',
  'this browser': 'ce navigateur',
  'Piano keyboard': 'Clavier de piano',
  'Your sustain pedal': 'Votre pédale de sustain',
  Pedal: 'Pédale',
  'Their sustain pedal': 'Leur pédale de sustain',
  'Their pedal': 'Leur pédale',
  'Loading the grand piano · {pct}%': 'Chargement du piano à queue · {pct} %',
  'Play with the computer keyboard: A W S E D F T G Y H U J K, Z / X change octave, Space is the pedal':
    'Jouer avec le clavier de l’ordinateur : Q Z S E D F T G Y H U J K sur un clavier AZERTY, W / X changent d’octave, Espace est la pédale',
  'Computer keys on · {note}': 'Clavier de l’ordinateur activé · {note}',
  'Play with computer keys': 'Jouer avec le clavier de l’ordinateur',
  'Hide keyboard': 'Masquer le clavier',
  'No direct connection to {name} yet': 'Pas encore de connexion directe avec {name}',
  'No direct connection yet': 'Pas encore de connexion directe',
  "Your two networks don't let the devices reach each other directly. This happens with some mobile networks, guest Wi-Fi, and company or school networks.":
    'Vos deux réseaux ne laissent pas les appareils se joindre directement. Cela arrive avec certains réseaux mobiles, les Wi-Fi invités et les réseaux d’entreprise ou d’école.',
  'Put both devices on the same Wi-Fi (not a guest network).':
    'Mettez les deux appareils sur le même Wi-Fi (pas un réseau invité).',
  "Or share a phone's connection (hotspot) with the other device.":
    'Ou partagez la connexion d’un téléphone (point d’accès) avec l’autre appareil.',
  'Still trying, by itself.': 'Nouvel essai automatique en cours.',
  'Your camera sends a black picture: is its cover closed, or is it switched off by a key on the keyboard?':
    'Votre caméra envoie une image noire : son cache est-il fermé, ou est-elle désactivée par une touche du clavier ?',
  'No picture from your camera: another app may be using it, or it is switched off by a key on the keyboard.':
    'Aucune image de votre caméra : une autre application l’utilise peut-être, ou elle est désactivée par une touche du clavier.',
  "Allow the camera and microphone in your browser's request, at the top of the window.":
    'Autorisez la caméra et le micro dans la demande de votre navigateur, en haut de la fenêtre.',
  "Camera blocked. Allow it from the icon in {browser}'s address bar: it starts at once.":
    'Caméra bloquée. Autorisez-la avec l’icône de la barre d’adresse de {browser} : elle démarre aussitôt.',
  "Microphone blocked. Allow it from the icon in {browser}'s address bar: it starts at once.":
    'Micro bloqué. Autorisez-le avec l’icône de la barre d’adresse de {browser} : il démarre aussitôt.',
  'Try again': 'Réessayer',
  'Send the link (or the code) to the other person.': 'Envoyez le lien (ou le code) à l’autre personne.',
  'Your camera shows a still image, not you: Windows is blocking it. Check Settings → Privacy & security → Camera, the camera key or cover, and close other apps using it (Teams, Zoom). Then turn the camera off and on below.':
    'Votre caméra affiche une image fixe, pas vous : Windows la bloque. Vérifiez Paramètres → Confidentialité et sécurité → Caméra, la touche ou le cache de la caméra, et fermez les autres applications qui l’utilisent (Teams, Zoom). Puis coupez et rallumez la caméra ci-dessous.',
  'Your camera shows a still image, not you: it may be blocked by the system or used by another app. Close other apps using it, then turn the camera off and on below.':
    'Votre caméra affiche une image fixe, pas vous : elle est peut-être bloquée par le système ou utilisée par une autre application. Fermez les autres applications qui l’utilisent, puis coupez et rallumez la caméra ci-dessous.',
  'Direct, same local network': 'Direct, même réseau local',
  'Direct, across the internet': 'Direct, par Internet',
  'Through a relay server (no direct path)': 'Par un serveur relais (pas de chemin direct)',
  relay: 'relais',
  'Remove steady background noise': 'Retirer le bruit de fond constant',
  Musician: 'Musicien',
  'Scan with a phone or tablet to join this room.':
    'Scannez avec un téléphone ou une tablette pour rejoindre cette salle.',
  'Enter your name and enter the room.': 'Indiquez votre nom et entrez dans la salle.',
  'They open it, and you see and hear each other.': 'Elle l’ouvre, et vous vous voyez et vous entendez.',
  'You are joining to watch and listen: a parent, a guest, or a phone as a second camera.':
    'Vous entrez pour regarder et écouter : un parent, un invité, ou un téléphone comme deuxième caméra.',
  'Join as a musician instead': 'Entrer plutôt en musicien',
  'They open the link, or type the code on Sonora Live, and appear here.':
    'Il suffit d’ouvrir le lien, ou de saisir le code sur Sonora Live, pour apparaître ici.',
  'To watch: a parent, a guest, a second camera': 'Pour regarder : un parent, un invité, une deuxième caméra',
  'With this link they watch and listen, without being asked to play. Scan it with a phone to add a second camera, for example pointed at the keys.':
    'Avec ce lien, on regarde et on écoute, sans être invité à jouer. Scannez-le avec un téléphone pour ajouter une deuxième caméra, par exemple pointée vers le clavier.',
  'Copy the link to watch': 'Copier le lien pour regarder',
  'Waiting for the musicians': 'En attente des musiciens',
  'Invite your student or your teacher': 'Invitez votre élève ou votre professeur',
  "Send the link or the code. They open it and appear here. You'll hear a chime.":
    'Envoyez le lien ou le code : il suffit de l’ouvrir pour apparaître ici. Un carillon vous préviendra.',
  'Backing tracks can be up to 100 MB.': 'Les pistes d’accompagnement peuvent faire jusqu’à 100 Mo.',
  'Not an audio file': 'Ce n’est pas un fichier audio',
  'Choose an MP3, WAV, FLAC, M4A or OGG file.': 'Choisissez un fichier MP3, WAV, FLAC, M4A ou OGG.',
  '{name} removed the backing track': '{name} a retiré la piste d’accompagnement',
  '{name} shared a backing track: {file}': '{name} a partagé une piste d’accompagnement : {file}',
  'Backing track from {name}': 'Piste d’accompagnement de {name}',
  '{file} plays here in time with the lesson. Set your own volume in the player.':
    '{file} est jouée ici en rythme avec le cours. Réglez votre propre volume dans le lecteur.',
  'This browser cannot play {file}': 'Ce navigateur ne peut pas lire {file}',
  'Try an MP3 or WAV file.': 'Essayez un fichier MP3 ou WAV.',
  Me: 'Moi',
  'Backing track': 'Piste d’accompagnement',
  'Receiving {file} · {pct}%': 'Réception de {file} · {pct} %',
  'Waiting for the track…': 'En attente de la piste…',
  'No backing track. Load an audio file: it plays for everyone, in time.':
    'Aucune piste d’accompagnement. Chargez un fichier audio : il est joué chez tout le monde, en rythme.',
  Change: 'Changer',
  'Load a track': 'Charger une piste',
  'Remove the track for everyone': 'Retirer la piste pour tout le monde',
  'Hide the player': 'Masquer le lecteur',
  'Back to the start': 'Revenir au début',
  Pause: 'Pause',
  Play: 'Lecture',
  Position: 'Position',
  'Speed (the pitch stays)': 'Vitesse (la hauteur ne change pas)',
  Speed: 'Vitesse',
  Slower: 'Plus lent',
  Faster: 'Plus rapide',
  'Key (the speed stays)': 'Tonalité (la vitesse ne change pas)',
  Key: 'Tonalité',
  'A semitone lower': 'Un demi-ton plus bas',
  'A semitone higher': 'Un demi-ton plus haut',
  'Repeat a passage: set its start and end while it plays, or from the position':
    'Répéter un passage : fixez son début et sa fin pendant la lecture, ou depuis la position',
  'The passage starts here': 'Le passage commence ici',
  'The passage ends here': 'Le passage finit ici',
  'No repeat': 'Ne plus répéter',
  'Who plays or sings along hears the track on time; the others hear it a little later, in time with them. Whoever presses Play is chosen; change it here.':
    'Qui joue ou chante avec la piste l’entend à l’heure ; les autres l’entendent un peu plus tard, en rythme avec cette personne. La personne qui appuie sur Lecture est choisie ; vous pouvez la changer ici.',
  'In time with': 'En rythme avec',
  'Someone who left': 'Quelqu’un qui est parti',
  '+{ms} ms here': '+{ms} ms ici',
  'My volume': 'Mon volume',
  'Backing track volume, on this device only': 'Volume de la piste d’accompagnement, sur cet appareil seulement',
  'Best with headphones: the track then never reaches your microphone.':
    'Idéal avec un casque : la piste n’atteint alors jamais votre micro.',
  Track: 'Piste',
  'Listening on': 'Écoute sur',
  Headphones: 'Casque',
  'Now: <b>headphones</b> ({name}). Nothing reaches your microphone, so nothing is taken out.':
    'Actuellement : <b>casque</b> ({name}). Rien n’atteint votre micro, donc rien n’est retiré.',
  'Now: <b>speakers</b>. Choose Headphones if you wear some: then nothing is processed.':
    'Actuellement : <b>haut-parleurs</b>. Choisissez Casque si vous en portez un : rien n’est alors traité.',
  'Nothing is taken out of your microphone: only with headphones, or the others hear themselves and it can howl.':
    'Rien n’est retiré de votre micro : seulement avec un casque, sinon les autres s’entendent eux-mêmes et cela peut siffler.',
  'Echo cancelling on speakers': 'Annulation d’écho sur haut-parleurs',
  'Music-safe (experimental)': 'Spéciale musique (expérimentale)',
  'Music-safe: your playing is never turned down while the others play, but a little echo may remain, especially on phone or laptop speakers. It learns your room in the first seconds the others play.':
    'Spéciale musique : votre jeu n’est jamais atténué quand les autres jouent, mais un peu d’écho peut rester, surtout sur les haut-parleurs d’un téléphone ou d’un ordinateur portable. Elle apprend votre pièce dans les premières secondes où les autres jouent.',
  'Standard: the browser’s echo cancelling. It removes echo reliably, but turns your playing down a little while the others play. Try Music-safe if your sustained notes sound cut for the others.':
    'Standard : l’annulation d’écho du navigateur. Elle retire l’écho de façon fiable, mais atténue un peu votre jeu quand les autres jouent. Essayez Spéciale musique si vos notes tenues paraissent coupées chez les autres.',
  'Either way, a backing track playing here is always taken out of your microphone.':
    'Dans les deux cas, une piste d’accompagnement jouée ici est toujours retirée de votre micro.',
  'Voice only always uses the browser’s echo cancelling.':
    'Voix seule utilise toujours l’annulation d’écho du navigateur.',
  'Others’ notes wait for their sound': 'Les notes des autres attendent leur son',
  'MIDI notes travel faster than the sound of a microphone. On: the others’ notes are held back until their microphone sound arrives, so their piano, their voice and their instrument are heard together. Off: their notes play the moment they arrive, a little before the rest of their sound.':
    'Les notes MIDI voyagent plus vite que le son d’un micro. Activé : les notes des autres sont retenues jusqu’à l’arrivée du son de leur micro, pour entendre ensemble leur piano, leur voix et leur instrument. Désactivé : leurs notes sont jouées dès leur arrivée, un peu avant le reste de leur son.',
  'Microphone sends': 'Le micro envoie',
  'Untouched sound, for an acoustic instrument and the voice.': 'Son intact, pour un instrument acoustique et la voix.',
  'The browser’s speech processing: removes noise and echo, and part of the music.':
    'Le traitement de la parole du navigateur : retire le bruit et l’écho, et une partie de la musique.',
  'Voice only during MIDI': 'Voix seule pendant le MIDI',
  'Echo cancelling runs now': 'L’annulation d’écho fonctionne en ce moment',
  'echo cancelled': 'écho annulé',
  'The speakers’ sound is taken out of the microphone, so the others do not hear themselves.':
    'Le son des haut-parleurs est retiré du micro, pour que les autres ne s’entendent pas eux-mêmes.',
  'Nothing reaches the microphone: nothing is taken out.': 'Rien n’atteint le micro : rien n’est retiré.',
  'Standard: the browser’s, removes echo reliably but turns the playing here down a little while the others play. Music-safe (experimental): never turns the playing down, may leave a little echo on small speakers. A backing track is always taken out.':
    'Standard : celle du navigateur, retire l’écho de façon fiable mais atténue un peu le jeu ici quand les autres jouent. Spéciale musique (expérimentale) : n’atténue jamais le jeu, peut laisser un peu d’écho sur de petits haut-parleurs. Une piste d’accompagnement est toujours retirée.',
  'Others’ notes on': 'Notes des autres sur',
  'Notes wait for sound': 'Notes calées sur le son',
  'their notes wait {ms} ms': 'leurs notes attendent {ms} ms',
  'Wearing headphones?': 'Vous portez un casque ?',
  Yes: 'Oui',
  'No, speakers': 'Non, haut-parleurs',
  'Studio sound: nothing processed, the lowest delay.': 'Son studio : aucun traitement, le délai le plus court.',
  'The others’ sound is taken out of your microphone, so they never hear themselves.':
    'Le son des autres est retiré de votre micro : ils ne s’entendent jamais eux-mêmes.',
  'Guessed: browsers do not say. Answer once, it is remembered for this output.':
    'Deviné : les navigateurs ne le disent pas. Répondez une fois, c’est retenu pour cette sortie.',
  'Speech processing, for talking in a noisy room (it takes part of the music out).':
    'Traitement de la parole, pour parler dans une pièce bruyante (il retire une partie de la musique).',
  'Chosen for every output (Settings → Sound).': 'Choisi pour toutes les sorties (Réglages → Son).',
  'Guessed: browsers do not say whether it is headphones. Choose to be sure.':
    'Deviné : les navigateurs ne disent pas s’il s’agit d’un casque. Choisissez pour en être sûr.',
  'Remembered for {name}.': 'Retenu pour {name}.',
  'Guessed from its name ({name}): browsers do not say whether it is headphones. Choose to be sure.':
    'Deviné d’après son nom ({name}) : les navigateurs ne disent pas s’il s’agit d’un casque. Choisissez pour en être sûr.',
  'More in Settings': 'Plus dans les réglages',
  voice: 'voix',
  'Sound: {mode}': 'Son : {mode}',
  speakers: 'haut-parleurs',
  'Tap to change': 'Touchez pour changer',
  'Automatic level (on speakers)': 'Niveau automatique (sur haut-parleurs)',
  'As said for this output, else guessed from its name (browsers do not tell).':
    'Comme indiqué pour cette sortie, sinon deviné d’après son nom (les navigateurs ne le disent pas).',
  'Before the track starts: one bar of clicks at the metronome’s tempo ({beats} beats at {bpm} BPM)':
    'Avant que la piste démarre : une mesure de clics au tempo du métronome ({beats} temps à {bpm} BPM)',
  'Count-in': 'Décompte',
  Metronome: 'Métronome',
  Tuner: 'Accordeur',
  'Music tools': 'Outils musicaux',
  'in use': 'en cours',
  'Hide the music tools': 'Masquer les outils musicaux',
  'Quarter notes': 'Noires',
  'Eighth notes': 'Croches',
  Triplets: 'Triolets',
  'Sixteenth notes': 'Doubles croches',
  'Stop the metronome': 'Arrêter le métronome',
  'Start the metronome': 'Lancer le métronome',
  'Start the metronome: it plays in time with you, for everyone':
    'Lancer le métronome : il joue en rythme avec vous, pour tout le monde',
  'Tempo, beats per minute': 'Tempo, en battements par minute',
  'Tap a few times in the tempo you want': 'Tapez quelques fois au tempo voulu',
  Tap: 'Taper',
  'Beats in a bar': 'Temps par mesure',
  Beats: 'Temps',
  'Clicks per beat': 'Clics par temps',
  'The first beat of each bar sounds higher': 'Le premier temps de chaque mesure sonne plus aigu',
  Accent: 'Accent',
  'Who plays along hears it on time; the others hear it a little later, in time with them. Whoever starts it is chosen; change it here.':
    'Qui joue avec l’entend à l’heure ; les autres l’entendent un peu plus tard, en rythme avec cette personne. La personne qui le lance est choisie ; vous pouvez la changer ici.',
  'Metronome volume, on this device only': 'Volume du métronome, sur cet appareil seulement',
  'Cents off the note': 'Écart à la note, en cents',
  'Play or sing a note': 'Jouez ou chantez une note',
  'Turn on your microphone to tune': 'Activez votre micro pour accorder',
  'The pitch of A4 your ensemble tunes to': 'La hauteur du la de référence de votre ensemble',
  'Reference pitch of A4': 'Hauteur de référence du la',
  'Keys, backing track, metronome and tuner': 'Clavier, piste d’accompagnement, métronome et accordeur',
  Music: 'Musique',
  'Listening…': 'Écoute…',
  'Two short sweeps from your speakers: if your microphone hears them, you are on speakers. Takes 2 seconds.':
    'Deux balayages courts dans vos haut-parleurs : si votre micro les entend, vous êtes sur haut-parleurs. Cela prend 2 secondes.',
  'Playing two short sweeps…': 'Deux balayages courts…',
  'Speakers: your microphone hears them, so their sound is taken out of it.':
    'Haut-parleurs : votre micro les entend, leur son en est donc retiré.',
  'Round trip {ms} ms.': 'Aller-retour {ms} ms.',
  'Headphones: nothing reaches your microphone, so nothing is processed.':
    'Casque : rien n’atteint votre micro, donc rien n’est traité.',
  'Bluetooth headphones can add a fifth of a second: to measure theirs, hold one earcup against your microphone and press Measure.':
    'Un casque Bluetooth peut ajouter un cinquième de seconde : pour mesurer le vôtre, tenez un écouteur contre votre micro et appuyez sur Mesurer.',
  Measure: 'Mesurer',
  'Headphones: {ms} ms more than the browser says. What the others play in time with you now waits for it.':
    'Casque : {ms} ms de plus que ce qu’indique le navigateur. Ce que les autres jouent en rythme avec vous en tient compte désormais.',
  'Headphones: no more delay than the browser says.': 'Casque : pas plus de délai que ce qu’indique le navigateur.',
  'Still nothing: hold the earcup closer to the microphone, turn the volume up, and try again.':
    'Toujours rien : rapprochez l’écouteur du micro, montez le volume et réessayez.',
  'The microphone could not be opened for the check.': 'Le micro n’a pas pu être ouvert pour le test.',
});
