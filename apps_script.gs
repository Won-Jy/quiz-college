/**
 * Quiz du college — carnet de points
 *
 * Installation
 * 1. Google Sheets → Extensions → Apps Script, coller ce fichier.
 * 2. Lancer une fois initialiser() depuis l'editeur (cree les deux onglets).
 * 3. Deployer → Nouveau deploiement → Application Web
 *      Executer en tant que : moi
 *      Acces : tout le monde
 * 4. Copier l'URL /exec dans config.json → "sheets_url".
 *
 * Rappel : toute modification du code exige un NOUVEAU deploiement.
 * Enregistrer ne suffit pas a mettre l'endpoint a jour.
 */

var ONGLET_RESULTATS = 'Resultats';
var ONGLET_RECOMPENSES = 'Recompenses';
var FUSEAU = 'Europe/Paris';

var EN_TETES_RESULTATS = ['Date', 'Matiere', 'Niveau', 'Score', 'Total', 'Points', 'Horodatage'];
var EN_TETES_RECOMPENSES = ['Horodatage', 'Type', 'Id', 'Libelle', 'Cout', 'Statut', 'Note'];


// ── Installation ─────────────────────────────────────────────────────────────

function initialiser() {
  var classeur = SpreadsheetApp.getActiveSpreadsheet();
  creerOnglet(classeur, ONGLET_RESULTATS, EN_TETES_RESULTATS);
  creerOnglet(classeur, ONGLET_RECOMPENSES, EN_TETES_RECOMPENSES);
  // Colonne A des resultats en texte brut : Sheets ne doit pas convertir les dates.
  classeur.getSheetByName(ONGLET_RESULTATS).getRange('A:A').setNumberFormat('@');
  return 'Onglets prets.';
}

function creerOnglet(classeur, nom, enTetes) {
  var feuille = classeur.getSheetByName(nom);
  if (!feuille) {
    feuille = classeur.insertSheet(nom);
  }
  if (feuille.getLastRow() === 0) {
    feuille.appendRow(enTetes);
    feuille.getRange(1, 1, 1, enTetes.length).setFontWeight('bold');
    feuille.setFrozenRows(1);
  }
  return feuille;
}

function feuille_(nom) {
  var classeur = SpreadsheetApp.getActiveSpreadsheet();
  var enTetes = nom === ONGLET_RESULTATS ? EN_TETES_RESULTATS : EN_TETES_RECOMPENSES;
  return creerOnglet(classeur, nom, enTetes);
}


// ── Dates ────────────────────────────────────────────────────────────────────

/** Ramene une cellule (texte ou Date) a une chaine AAAA-MM-JJ. */
function normaliserDate_(valeur) {
  if (valeur instanceof Date) {
    return Utilities.formatDate(valeur, FUSEAU, 'yyyy-MM-dd');
  }
  return String(valeur || '').trim().slice(0, 10);
}

/** Lundi de la semaine contenant la date ISO donnee. */
function lundiDe_(iso) {
  var p = iso.split('-');
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  var decalage = (d.getDay() + 6) % 7; // dimanche = 6
  d.setDate(d.getDate() - decalage);
  return d.getFullYear() + '-' +
         ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
         ('0' + d.getDate()).slice(-2);
}

function maintenant_() {
  return Utilities.formatDate(new Date(), FUSEAU, 'yyyy-MM-dd HH:mm:ss');
}

function aujourdhui_() {
  return Utilities.formatDate(new Date(), FUSEAU, 'yyyy-MM-dd');
}


// ── Lecture ──────────────────────────────────────────────────────────────────

function lireResultats_() {
  var lignes = feuille_(ONGLET_RESULTATS).getDataRange().getValues().slice(1);
  return lignes.filter(function (l) { return l[0]; }).map(function (l) {
    return {
      date: normaliserDate_(l[0]),
      matiere: String(l[1] || ''),
      niveau: String(l[2] || ''),
      score: Number(l[3]) || 0,
      total: Number(l[4]) || 0,
      points: Number(l[5]) || 0
    };
  });
}

function lireRecompenses_() {
  var lignes = feuille_(ONGLET_RECOMPENSES).getDataRange().getValues().slice(1);
  return lignes.filter(function (l) { return l[0]; }).map(function (l) {
    return {
      horodatage: String(l[0]),
      type: String(l[1] || ''),
      id: String(l[2] || ''),
      libelle: String(l[3] || ''),
      cout: Number(l[4]) || 0,
      statut: String(l[5] || '')
    };
  });
}

function calculerEtat_() {
  var resultats = lireResultats_();
  var recompenses = lireRecompenses_();

  var gagnes = resultats.reduce(function (s, r) { return s + r.points; }, 0);
  var depenses = recompenses.reduce(function (s, r) {
    return r.statut === 'approuve' ? s + r.cout : s;
  }, 0);
  var reserves = recompenses.reduce(function (s, r) {
    return r.statut === 'en_attente' ? s + r.cout : s;
  }, 0);

  var lundi = lundiDe_(aujourdhui_());
  var datesSemaine = {};
  resultats.forEach(function (r) {
    if (lundiDe_(r.date) === lundi) { datesSemaine[r.date] = true; }
  });

  return {
    ok: true,
    solde: gagnes - depenses,
    disponible: gagnes - depenses - reserves,
    total_gagne: gagnes,
    total_depense: depenses,
    semaine: { lundi: lundi, jours: Object.keys(datesSemaine).length },
    fait_aujourdhui: resultats.some(function (r) { return r.date === aujourdhui_(); }),
    resultats: resultats.slice(-40),
    recompenses: recompenses.slice(-40)
  };
}


// ── Ecriture ─────────────────────────────────────────────────────────────────

function enregistrerResultat_(d) {
  var date = normaliserDate_(d.date || aujourdhui_());
  var resultats = lireResultats_();

  // Un seul enregistrement par jour : on ne rejoue pas pour cumuler des points.
  for (var i = 0; i < resultats.length; i++) {
    if (resultats[i].date === date) {
      return { ok: false, raison: 'deja_enregistre', etat: calculerEtat_() };
    }
  }

  feuille_(ONGLET_RESULTATS).appendRow([
    date,
    String(d.matiere || ''),
    String(d.niveau || ''),
    Number(d.score) || 0,
    Number(d.total) || 0,
    Number(d.points) || 0,
    maintenant_()
  ]);

  var hebdo = verifierRecompenseHebdo_(date, Number(d.jours_requis) || 6, String(d.libelle_hebdo || 'Récompense de la semaine'));
  return { ok: true, recompense_hebdo: hebdo, etat: calculerEtat_() };
}

function verifierRecompenseHebdo_(date, joursRequis, libelle) {
  var lundi = lundiDe_(date);
  var dejaAcquise = lireRecompenses_().some(function (r) {
    return r.type === 'hebdo' && r.id === lundi;
  });
  if (dejaAcquise) { return null; }

  var dates = {};
  lireResultats_().forEach(function (r) {
    if (lundiDe_(r.date) === lundi) { dates[r.date] = true; }
  });
  if (Object.keys(dates).length < joursRequis) { return null; }

  feuille_(ONGLET_RECOMPENSES).appendRow([
    maintenant_(), 'hebdo', lundi, libelle, 0, 'acquise', 'Semaine du ' + lundi
  ]);
  return { libelle: libelle, semaine: lundi };
}

function demanderRecompense_(d) {
  var cout = Number(d.cout) || 0;
  var etat = calculerEtat_();
  if (etat.disponible < cout) {
    return { ok: false, raison: 'solde_insuffisant', etat: etat };
  }
  feuille_(ONGLET_RECOMPENSES).appendRow([
    maintenant_(), 'boutique', String(d.id || ''), String(d.libelle || ''),
    cout, 'en_attente', ''
  ]);
  return { ok: true, etat: calculerEtat_() };
}


// ── Points d'entree ──────────────────────────────────────────────────────────

function reponse_(objet) {
  return ContentService
    .createTextOutput(JSON.stringify(objet))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    return reponse_(calculerEtat_());
  } catch (err) {
    return reponse_({ ok: false, erreur: String(err) });
  }
}

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.action === 'resultat') { return reponse_(enregistrerResultat_(d)); }
    if (d.action === 'demande') { return reponse_(demanderRecompense_(d)); }
    return reponse_({ ok: false, raison: 'action_inconnue' });
  } catch (err) {
    return reponse_({ ok: false, erreur: String(err) });
  }
}
