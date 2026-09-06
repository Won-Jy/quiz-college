# Quiz du collège

Quiz quotidien envoyé par e-mail du lundi au samedi à 16 h (heure de Paris).
Une matière par jour, 5 QCM conformes au programme officiel français, corrections
affichées à la fin, et une cagnotte de points adossée à Google Sheets.

Interface entièrement en français. Le paramétrage se fait dans `config.json`.

---

## Arborescence

```
config.json                  tout le paramétrage
programme.json               chapitres par niveau et par matière
generate_quiz.py             génération + envoi de l'e-mail
apps_script.gs               carnet de points (à coller dans Google Sheets)
.github/workflows/quiz.yml   planification
quiz/index.html              application
quiz/quiz.css
quiz/quiz.js
data/                        un fichier JSON par jour + history.json
data/demo.json               quiz de démonstration
```

---

## Installation

### 1. Dépôt et GitHub Pages

Créer un dépôt `quiz-college`, y déposer tous ces fichiers en respectant
l'arborescence. Puis **Settings → Pages → Source : Deploy from a branch**,
branche `main`, dossier `/ (root)`.

Vérifier ensuite `config.json` → `base_url` (par défaut
`https://won-jy.github.io/quiz-college`).

### 2. Secrets

**Settings → Secrets and variables → Actions → New repository secret** :

| Nom | Valeur |
|---|---|
| `ANTHROPIC_API_KEY` | clé API Anthropic |
| `GMAIL_USER` | adresse Gmail expéditrice |
| `GMAIL_APP_PASSWORD` | mot de passe d'application Gmail (16 caractères) |

### 3. Carnet de points

1. Créer une feuille Google Sheets.
2. **Extensions → Apps Script**, coller `apps_script.gs`, enregistrer.
3. Exécuter la fonction `initialiser()` une fois (crée les onglets `Resultats`
   et `Recompenses`).
4. **Déployer → Nouveau déploiement → Application Web** :
   exécuter en tant que *moi*, accès *tout le monde*.
5. Copier l'URL `/exec` dans `config.json` → `sheets_url`.

Toute modification ultérieure du script exige un **nouveau déploiement** :
enregistrer ne met pas l'endpoint à jour.

### 4. Premier essai

**Actions → Quiz du jour → Run workflow.** Le lancement manuel contourne le
contrôle horaire. Sans attendre l'envoi, la démonstration est visible sur
`…/quiz/?date=demo`.

---

## Réglages courants

Tout est dans `config.json`.

**Changer le planning.** `1` = lundi … `6` = samedi. Retirer une clé supprime le
quiz de ce jour-là. Matières disponibles : `francais`, `anglais`, `maths`,
`histoire`.

**Changer la difficulté.** `difficulte` : `facile`, `normale` ou `exigeante`.

**Changer le niveau.** `niveau_manuel` force un niveau (`"5eme"` par exemple).
Laissé à `null`, le niveau monte automatiquement chaque 1er juin à partir de
`niveau_base_annee`.

**Changer les récompenses.** `recompense_hebdo` pour la récompense de
participation, `boutique` pour les échanges de points.

**Changer l'heure d'envoi.** Dans `.github/workflows/quiz.yml`, les deux `cron`
et l'heure testée par l'étape de garde doivent bouger ensemble. Les deux crons
couvrent le passage à l'heure d'été ; la garde ne laisse passer que le bon.

**Ajouter des chapitres.** `programme.json`. Le script tourne dans la liste, un
chapitre à chaque passage de la matière, et évite les notions vues récemment.
Un niveau absent du fichier (2nde et au-delà) déclenche un repli : le modèle
choisit lui-même un chapitre du programme officiel.

---

## Fonctionnement des points

| Action | Points |
|---|---|
| Quiz terminé | 10 |
| Chaque bonne réponse | 2 |
| Sans faute | 5 |

Deux pistes indépendantes :

- **Participation.** 6 quiz dans la semaine (3 pendant les vacances scolaires)
  déclenchent la récompense hebdomadaire, quel que soit le score. Elle ne coûte
  aucun point.
- **Cagnotte.** Les points s'accumulent sans remise à zéro. Une demande
  d'échange passe en `en_attente` dans l'onglet `Recompenses` ; il suffit de
  remplacer ce statut par `approuve` pour la valider — le solde est alors
  débité. `refuse` libère les points.

Un seul enregistrement par jour : rejouer le quiz ne recrédite rien.

---

## Diagnostic

**Rien n'arrive à 16 h.** Vérifier les logs de l'étape de garde dans Actions.
GitHub décale parfois les crons de plusieurs minutes ; si le décalage dépasse
l'heure entière, la garde bloque l'exécution. Ajouter un troisième cron voisin
règle le problème.

**« Aucun quiz pour le … »** Le fichier `data/AAAA-MM-JJ.json` n'a pas été
publié. GitHub Pages met une à deux minutes à se rafraîchir après le commit.

**La cagnotte affiche un tiret.** `sheets_url` absente de `config.json`, ou
déploiement Apps Script non renouvelé après une modification du script.

**Les dates de l'onglet `Resultats` deviennent des jours de la semaine.**
Sélectionner la colonne A → **Format → Nombre → Texte brut**.
`initialiser()` le fait normalement à la création.

**Vacances scolaires.** Les dates de `config.json` couvrent la zone B
(académie d'Aix-Marseille) pour 2026-2027. À remettre à jour chaque été.
