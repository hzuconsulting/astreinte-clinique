<img src="docs/logo.svg" width="96" alt="">

# Astreintes — Clinique

Planning d'astreinte assisté pour une équipe de chirurgiens, mobile-first.
Un médecin d'astreinte chaque jour, et une répartition **équitable sur l'année** :
d'abord les **jours fériés**, ensuite les **week-ends**, enfin le **total**.

## Ce que fait l'application

- **Calendrier mensuel.** Chaque jour affiche le médecin d'astreinte (initiales en
  couleur), les fériés (★), les absents (points) et les conflits (cadre rouge).
- **Assistant de génération.** Un bouton remplit le mois, la fin de l'année, l'année
  entière ou une période libre. Il tient compte de tout ce qui est déjà planifié dans
  l'année : si quelqu'un a beaucoup donné au premier trimestre, il est épargné ensuite.
- **Jours travaillés récurrents.** Pour chaque médecin, on coche les jours de la
  semaine où il travaille (ex. pas le lundi). Il n'est jamais mis d'astreinte un jour
  non travaillé — sauf si personne d'autre n'est présent, et c'est alors signalé.
- **Absences.** Vacances, congrès, formation… sur une plage de dates. Un absent n'est
  jamais d'astreinte. Si une absence est saisie après coup sur des jours déjà attribués,
  l'application le signale et propose de réattribuer en un geste.
- **Choix manuels.** Toucher un jour ouvre la liste des médecins **classés par
  l'assistant**, avec les raisons (« d'astreinte la veille », « jour non travaillé »,
  « absent — congrès »). Un choix manuel est verrouillé 🔒 : les générations suivantes
  n'y touchent plus.
- **Week-ends groupés.** Le week-end d'astreinte va du **vendredi au dimanche**
  (réglable en samedi → dimanche) et revient à une seule personne, avec le férié
  accolé (jeudi de l'Ascension, lundi de Pâques…). Le vendredi compte comme un jour
  de week-end dans l'équité. Désactivable.
- **Repos minimum** entre deux astreintes (réglable, 1 jour par défaut).
- **Pas deux week-ends d'affilée** pour la même personne, si c'est possible ; sinon
  c'est signalé après la génération.
- **Jours d'astreinte consécutifs max** (4 par défaut, réglable de 1 à 7 ou sans
  limite). Un week-end prolongé plus long est partagé : le week-end reste entier, le
  férié accolé va à quelqu'un d'autre.
- **Part de la charge** par médecin (100 %, 80 %, 50 %…) pour un temps partiel.
- **Fériés français** calculés automatiquement (Pâques, Ascension, Pentecôte…),
  option Alsace-Moselle, et ajout de jours spéciaux (fermeture de la clinique…).
- **Bilan annuel** : fériés (avec les dates), jours de week-end, total, répartition
  par jour de semaine, et un indicateur « Équilibré / Écart ».
- **Données communes** : une seule version, en ligne, identique pour tous.
- **Export** : fichier **.ics** par médecin pour l'agenda du téléphone, impression du
  mois, sauvegarde/restauration en fichier JSON.

## Comment fonctionne l'assistant

Pas de service d'IA externe : un **optimiseur** tourne dans le navigateur, en quelques
centaines de millisecondes pour une année. Aucune donnée ne quitte le téléphone.

1. Le calendrier est découpé en blocs : un week-end (+ pont) est un bloc, un jour de
   semaine est un bloc d'un jour, les jours verrouillés sont fixes.
2. Une fonction de coût mesure l'iniquité sur l'année civile (historique compris) :
   écart des fériés (poids 6), des jours de week-end (3), du total (1), des jours de
   semaine (0,3), astreintes trop rapprochées (4), jour non travaillé (500).
   Les absences sont des interdits absolus.
3. Une construction gloutonne (fériés, puis week-ends, puis semaine) est améliorée
   par **recuit simulé** (réattributions et échanges de blocs), sur 3 essais.

Le code est dans `src/lib/scheduler.ts`, les tests dans `src/lib/scheduler.test.ts`.

## Où sont les données ?

**Il n'y a qu'un seul planning**, enregistré en ligne sur Supabase : tout le monde
voit les mêmes informations, quel que soit celui qui les modifie. Pas de compte, pas
de session, pas d'invitation : on ouvre le site, c'est tout.

- Chaque modification est envoyée en ligne après une demi-seconde ; celles des
  autres arrivent toutes les 10 s et au retour sur l'appli. La pastille en haut
  indique « ● À jour » ou « Hors ligne ».
- Si deux personnes modifient en même temps, les deux modifications sont gardées
  (sur un même jour, la dernière enregistrée l'emporte).
- Chaque appareil garde une copie : l'appli s'affiche immédiatement et reste
  consultable sans réseau ; une modification faite hors ligne part au retour du réseau.

La connexion (URL du projet et clé *publishable*, faite pour être publique) est dans
`src/lib/sync.ts`. Pour pointer une autre base sans toucher au code : variables
`NEXT_PUBLIC_SUPABASE_URL` et `NEXT_PUBLIC_SUPABASE_KEY` au build.

Préparer une nouvelle base : **SQL Editor → New query**, coller
`supabase/schema.sql`, **Run**. La table n'est pas lisible directement, seulement via
deux fonctions.

⚠️ Toute personne qui connaît l'adresse du site peut lire et modifier le planning.

Un projet Supabase gratuit est mis en pause après une semaine sans aucune visite ;
l'usage quotidien suffit à l'éviter, sinon on le relance d'un clic depuis le tableau
de bord Supabase.

## Développer

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # tests du moteur
npm run typecheck
npm run build:static # site statique dans out/
```

## Déployer sur GitHub Pages

1. Pousser ce dépôt sur GitHub (branche `main`).
2. **Settings → Pages → Source : « GitHub Actions »**.
3. Chaque push sur `main` vérifie les types, lance les tests, construit et publie.
   Le site est servi sur `https://<compte>.github.io/<nom-du-depot>/`.
