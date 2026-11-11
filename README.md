# Écran shop - Tesla

| Page | Pour qui | Adresse |
|---|---|---|
| Gestion | Les conseillers (téléphone) | `https://VOTRE-COMPTE.github.io/ecran-shop/` (mot de passe) |
| Écran TV | La Samsung du shop | `https://VOTRE-COMPTE.github.io/ecran-shop/tv.html` |

Le site est entièrement gratuit :

- **GitHub Pages** héberge les pages (dossier `docs/`).
- **Supabase** stocke le message, les raccourcis, les réglages, les photos/vidéos et gère la connexion.

## Fonctionnement

- **Message** : touchez un raccourci (« Nous sommes en Test Drive · 20 min ») → la TV affiche le message, un compte à rebours et l'heure de retour. Boutons **+5 à +30 min** et **-5 à -30 min**, puis **Retirer le message**. Un message oublié disparaît tout seul 15 min après l'heure de retour.
- **Pas de message** : la TV fait tourner les photos et vidéos de l'onglet **Médias**, ou un écran d'accueil s'il n'y en a pas.
- **QR code** sur la TV : mène directement à la page Test Drive de Tesla (lien réglable dans **Réglages**). Aucune donnée client ne passe par le site.
- Les téléphones se synchronisent instantanément ; la TV se met à jour toutes les 4 secondes.

## Installation

### 1. Supabase (base de données)

1. Créez un compte sur [supabase.com](https://supabase.com), puis **New project** (région : *West EU* ou *Central EU*).
2. **SQL Editor → New query** : collez le contenu de `supabase/setup.sql` puis **Run**.
3. **Authentication → Sign In / Providers** : désactivez **Allow new users to sign up** (indispensable : sinon n'importe qui pourrait créer un compte).
4. **Authentication → Users → Add user → Create new user** : l'adresse de l'équipe et le mot de passe partagé, case **Auto Confirm User** cochée.
5. **Project Settings → API Keys** : notez la **Project URL** et la clé **publishable** (ou *anon public*). Elles ne sont pas secrètes.

### 2. Configuration

Dans `docs/config.js`, renseignez `supabaseUrl`, `supabaseKey` et `teamEmail` (l'adresse du compte créé à l'étape 1.4). Ce fichier est public : n'y mettez **jamais** de mot de passe.

### 3. GitHub Pages

1. Publiez ce dossier dans un dépôt GitHub **public** (GitHub Pages gratuit l'exige).
2. **Settings → Pages** : *Deploy from a branch*, branche `main`, dossier `/docs`.

## Installer la Samsung

1. Application **Internet** de la TV → adresse `…/tv.html` → ajoutez-la aux favoris.
2. **OK** sur la télécommande pour le plein écran.
3. Réglages TV : désactivez **Protection automatique**, **Mise hors tension auto** et l'économiseur d'écran.

Un point orange en haut à gauche de la TV signale une perte de connexion (elle garde le dernier affichage).

## Limites du plan gratuit Supabase

- **50 Mo par fichier** : préférez des photos et des vidéos courtes (MP4 H.264, 1080p, 30-60 s).
- **Pause après 7 jours sans activité** : tant que la TV tourne, le projet reste actif. Après de longues vacances, ouvrez Supabase et cliquez sur **Restore project**.
- Bande passante : 5 Go/mois. Les photos sont mises en cache par la TV ; évitez les vidéos très lourdes en boucle.

## Logo

`docs/brand/` : le « T » rouge (`Tesla_T_symbol.svg`, Wikimedia Commons) et le mot TESLA (découpé dans `Tesla_logo.png`, Wikimedia Commons) en blanc et en noir. Remplaçables par les fichiers officiels internes en gardant les mêmes noms.

## Version locale (ancienne)

`server.js` et `public/` sont la première version, qui tourne sur un ordinateur (`npm install` puis `npm start`, réglages dans `.env`, voir `.env.example`). Elle n'est plus nécessaire avec GitHub Pages + Supabase.
