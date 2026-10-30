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
  'They open the link (or type the code on Sonora Live), choose Student, Teacher or Observer, and appear here. Scan the QR code with a phone to add it as a second camera, for example pointed at the keys.':
    'Il leur suffit d’ouvrir le lien (ou de saisir le code sur Sonora Live) et de choisir Élève, Professeur ou Observateur pour apparaître ici. Scannez le QR code avec un téléphone pour l’ajouter comme deuxième caméra, par exemple pointée vers le clavier.',
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
  'Auto (recommended)': 'Auto (recommandé)',
  'Pure sound for your instrument; voice mode while MIDI carries your piano.':
    'Son pur pour votre instrument ; mode voix pendant que le MIDI transmet votre piano.',
  'Pure instrument': 'Instrument pur',
  'No noise suppression, no echo cancelling, stereo. Use headphones.':
    'Sans réduction de bruit ni annulation d’écho, en stéréo. Utilisez un casque.',
  Voice: 'Voix',
  'Speech processing: removes noise and echo (and some of the music).':
    'Traitement de la parole : supprime le bruit et l’écho (et un peu de la musique).',
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
  auto: 'auto',
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
  'Sound: {mode}': 'Son : {mode}',
  'Auto · tap to change': 'Auto · touchez pour changer',
  'Manual · tap to change': 'Manuel · touchez pour changer',
  'Hide piano keys': 'Masquer le clavier',
  'Show piano keys': 'Afficher le clavier',
  'Switch camera': 'Changer de caméra',
  Invite: 'Inviter',
  Leave: 'Quitter',
  'Leave the lesson': 'Quitter le cours',
  'Camera and microphone turn off.': 'La caméra et le micro se coupent.',
  Stay: 'Rester',
  Student: 'Élève',
  Teacher: 'Professeur',
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
  'Microphone: voice mode': 'Micro : mode voix',
  'Microphone: pure sound': 'Micro : son pur',
  'Your piano now travels as MIDI, so your microphone is tuned for speech.':
    'Votre piano passe désormais en MIDI : votre micro est donc réglé pour la parole.',
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
  'Here to learn': 'Je viens apprendre',
  'Giving the lesson': 'Je donne le cours',
  'Parent, guest': 'Parent, invité',
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
  'Scan with a phone or tablet to join this room (handy for a second camera).':
    'Scannez avec un téléphone ou une tablette pour rejoindre cette salle (pratique pour une deuxième caméra).',
  'Your name': 'Votre nom',
  'e.g. Clara': 'ex. Clara',
  "I'm joining as": 'Je rejoins en tant que',
  'Enter the room': 'Entrer dans la salle',
  'Use headphones, wired if you can: pure sound has no echo cancelling, and Bluetooth adds delay.':
    'Utilisez un casque, filaire si possible : le son pur n’a pas d’annulation d’écho, et le Bluetooth ajoute du retard.',
  Use: 'OK',
  'Have a code? Join another room': 'Vous avez un code ? Rejoindre une autre salle',
  'No account. No server sees your lesson.': 'Sans compte. Aucun serveur ne voit votre cours.',
  'How it works': 'Fonctionnement',
  Privacy: 'Confidentialité',
  'Camera off': 'Caméra coupée',
  'Connecting…': 'Connexion…',
  '{name} plays over MIDI': '{name} joue en MIDI',
  'Unprocessed sound (no noise suppression)': 'Son brut (sans réduction de bruit)',
  'Speech processing on': 'Traitement de la parole activé',
  'Pure · stereo': 'Pur · stéréo',
  'Estimated delay of the sound from {name}': 'Retard estimé du son de {name}',
  'second camera': 'deuxième caméra',
  screen: 'écran',
  'Microphone off': 'Micro coupé',
  'Reconnecting…': 'Reconnexion…',
  'Connecting to a new participant…': 'Connexion à un nouveau participant…',
  'Connecting to {name}…': 'Connexion à {name}…',
  "You're in. Waiting for others…": 'Vous êtes dans la salle. En attente des autres…',
  'Invite your student': 'Invitez votre élève',
  'Invite your teacher': 'Invitez votre professeur',
  'Invite the others': 'Invitez les autres',
  "Send the link or the code. They open it, pick their role, and appear here. You'll hear a chime.":
    'Envoyez le lien ou le code. Il suffit de l’ouvrir et de choisir son rôle pour apparaître ici. Un carillon vous préviendra.',
  'Scan to join': 'Scannez pour entrer',
  sent: 'envoyé',
  'tap to open': 'touchez pour ouvrir',
  incomplete: 'incomplet',
  'Close chat': 'Fermer la discussion',
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
  'Now: <b>pure</b>. Your microphone sends your instrument untouched; while your piano travels as MIDI, it switches to voice processing so speech stays clear.':
    'Actuellement : <b>son pur</b>. Votre micro transmet votre instrument tel quel ; quand votre piano transite en MIDI, il passe au traitement de la voix pour que la parole reste claire.',
  'Now: <b>voice</b>. Your microphone sends your instrument untouched; while your piano travels as MIDI, it switches to voice processing so speech stays clear.':
    'Actuellement : <b>voix</b>. Votre micro transmet votre instrument tel quel ; quand votre piano transite en MIDI, il passe au traitement de la voix pour que la parole reste claire.',
  'No noise suppression, no echo cancellation, no automatic volume, stereo when your microphone has it: every sustain, pedal and pianissimo arrives as played.':
    'Ni réduction de bruit, ni annulation d’écho, ni volume automatique, et la stéréo si votre micro la permet : chaque tenue, chaque pédale et chaque pianissimo arrive tel que joué.',
  "The browser's speech processing: removes background noise and echo, and part of the music with it.":
    'Le traitement de la parole du navigateur : il supprime le bruit de fond et l’écho, et une partie de la musique avec.',
  'Pure sound has no echo cancelling: use headphones (wired ones add no delay), or the others will hear themselves.':
    'Le son pur n’a pas d’annulation d’écho : utilisez un casque (filaire, il n’ajoute aucun retard), sinon les autres s’entendront eux-mêmes.',
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
  'Enter your name, choose your role and enter the room.':
    'Indiquez votre nom, choisissez votre rôle et entrez dans la salle.',
  'Send the link (or the code) to the other person.': 'Envoyez le lien (ou le code) à l’autre personne.',
  'They open it, choose their role, and you see and hear each other.':
    'Elle l’ouvre, choisit son rôle, et vous vous voyez et vous entendez.',
});
