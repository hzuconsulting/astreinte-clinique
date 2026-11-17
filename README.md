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
- **Week-ends groupés.** Samedi et dimanche vont à la même personne, avec le pont
  férié accolé (vendredi de Noël, lundi de Pentecôte…). Désactivable.
- **Repos minimum** entre deux astreintes (réglable, 1 jour par défaut).
- **Part de la charge** par médecin (100 %, 80 %, 50 %…) pour un temps partiel.
- **Fériés français** calculés automatiquement (Pâques, Ascension, Pentecôte…),
  option Alsace-Moselle, et ajout de jours spéciaux (fermeture de la clinique…).
- **Bilan annuel** : fériés (avec les dates), jours de week-end, total, répartition
  par jour de semaine, et un indicateur « Équilibré / Écart ».
- **Partage** : un lien contient tout le planning ; le collègue qui l'ouvre récupère
  cette version. Export **.ics** par médecin pour l'agenda du téléphone, impression du
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

Dans le navigateur de chaque appareil (localStorage). Il n'y a pas de serveur : le
site est 100 % statique, publié sur GitHub Pages. Pour travailler à trois, une
personne tient le planning et envoie le lien de partage après chaque modification
(ou chacun réimporte la dernière version). Penser à exporter une sauvegarde de temps
en temps.

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
