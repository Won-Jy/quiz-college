/* Quiz du college — logique de l'application
   Une question a la fois, aucune correction avant la fin,
   puis envoi du score au carnet de points. */

(function () {
  'use strict';

  var LETTRES = ['A', 'B', 'C', 'D'];
  var JOURS_COURTS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

  var etat = {
    config: null,
    quiz: null,
    index: 0,
    choix: [],
    selection: null
  };

  // ── Outils ────────────────────────────────────────────────────────────────

  function $(id) { return document.getElementById(id); }

  function afficher(nom) {
    ['chargement', 'vide', 'quiz', 'resultats', 'cagnotte'].forEach(function (v) {
      $('vue-' + v).hidden = (v !== nom);
    });
    window.scrollTo(0, 0);
  }

  function dateParis() {
    return new Intl.DateTimeFormat('fr-CA', {
      timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
  }

  function dateLisible(iso) {
    var p = iso.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    var texte = d.toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
    return texte.charAt(0).toUpperCase() + texte.slice(1);
  }

  function memoire(cle, valeur) {
    try {
      if (valeur === undefined) { return JSON.parse(localStorage.getItem(cle)); }
      if (valeur === null) { localStorage.removeItem(cle); }
      else { localStorage.setItem(cle, JSON.stringify(valeur)); }
    } catch (e) { /* mode prive ou stockage plein : on continue sans */ }
    return null;
  }

  function texte(el, valeur) { el.textContent = valeur; }

  // ── Reseau ────────────────────────────────────────────────────────────────

  function urlCarnet() {
    var u = etat.config && etat.config.sheets_url;
    return (u && u.indexOf('http') === 0) ? u : null;
  }

  function lireCarnet() {
    var url = urlCarnet();
    if (!url) { return Promise.resolve(null); }
    return fetch(url + '?action=etat&t=' + Date.now())
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
  }

  function ecrireCarnet(charge) {
    var url = urlCarnet();
    if (!url) {
      return Promise.resolve({ ok: false, raison: 'carnet_absent' });
    }
    // text/plain evite la requete preflight, qu'Apps Script ne gere pas.
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(charge)
    })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, raison: 'reseau' }; });
  }

  // ── Questions ─────────────────────────────────────────────────────────────

  function dessinerPips() {
    var ol = $('pips');
    ol.innerHTML = '';
    etat.quiz.questions.forEach(function (_, i) {
      var li = document.createElement('li');
      if (i < etat.index) { li.className = 'faite'; }
      else if (i === etat.index) { li.className = 'active'; }
      ol.appendChild(li);
    });
  }

  // ── Correction des reponses tapees ────────────────────────────────────────
  // Pas d'appel reseau : les formes acceptees sont generees avec le quiz.
  // On compare apres une normalisation identique des deux cotes.

  function normaliser(valeur) {
    var t = String(valeur || '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/[\u2019\u2018\u0060\u00b4]/g, "'")   // apostrophes typographiques
      .replace(/[\u00a0\u202f]/g, ' ')                // espaces insecables
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[.!?;:]+$/, '')                        // ponctuation finale
      .trim();
    // Nombres : 0,75 = 0.75 ; 1 000 = 1000 ; 3 / 4 = 3/4 ; 12.0 = 12
    if (/^[\d\s.,\/\-+]+$/.test(t)) {
      t = t.replace(/,/g, '.').replace(/\s+/g, '');
      t = t.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');   // 0.750 = 0.75, 12.0 = 12
    }
    return t;
  }

  function estJuste(q, reponse) {
    if (q.type === 'saisie') {
      var r = normaliser(reponse);
      if (!r) { return false; }
      return (q.reponses_acceptees || []).some(function (a) {
        return normaliser(a) === r;
      });
    }
    return reponse === q.reponse;
  }

  function reponseLisible(q, reponse) {
    if (q.type === 'saisie') { return String(reponse || '').trim() || '—'; }
    return q.options[reponse] || '—';
  }

  function bonneReponseLisible(q) {
    if (q.type === 'saisie') { return (q.reponses_acceptees || [])[0] || ''; }
    return q.options[q.reponse];
  }

  function dessinerQuestion() {
    var q = etat.quiz.questions[etat.index];
    var total = etat.quiz.questions.length;

    dessinerPips();
    texte($('quiz-rang'), 'Question ' + (etat.index + 1) + ' sur ' + total);
    texte($('quiz-enonce'), q.question);

    var conteneur = $('quiz-options');
    conteneur.innerHTML = '';
    etat.selection = null;

    var suivant = $('bouton-suivant');
    suivant.disabled = true;
    suivant.textContent = (etat.index === total - 1) ? 'Terminer' : 'Valider';

    if (q.type === 'saisie') {
      dessinerSaisie(q, conteneur);
      return;
    }

    q.options.forEach(function (option, i) {
      var bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'option';
      bouton.setAttribute('role', 'radio');
      bouton.setAttribute('aria-checked', 'false');

      var lettre = document.createElement('span');
      lettre.className = 'lettre';
      lettre.textContent = LETTRES[i];
      var libelle = document.createElement('span');
      libelle.textContent = option;
      bouton.appendChild(lettre);
      bouton.appendChild(libelle);

      bouton.addEventListener('click', function () {
        etat.selection = i;
        Array.prototype.forEach.call(conteneur.children, function (autre, j) {
          autre.setAttribute('aria-checked', String(j === i));
        });
        $('bouton-suivant').disabled = false;
      });

      conteneur.appendChild(bouton);
    });
  }

  function dessinerSaisie(q, conteneur) {
    var champ = document.createElement('input');
    champ.type = 'text';
    champ.className = 'saisie';
    champ.autocomplete = 'off';
    champ.autocapitalize = 'off';
    champ.spellcheck = false;
    champ.setAttribute('aria-label', 'Ta réponse');
    champ.placeholder = 'Tape ta réponse ici';

    var aide = document.createElement('p');
    aide.className = 'note';
    aide.textContent = 'Pas de proposition pour celle-ci : écris la réponse exacte, accents compris.';

    champ.addEventListener('input', function () {
      etat.selection = champ.value.trim() ? champ.value : null;
      $('bouton-suivant').disabled = (etat.selection === null);
    });
    champ.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && etat.selection !== null) {
        e.preventDefault();
        questionSuivante();
      }
    });

    conteneur.appendChild(champ);
    conteneur.appendChild(aide);
    setTimeout(function () { champ.focus(); }, 60);
  }

  function questionSuivante() {
    if (etat.selection === null) { return; }
    etat.choix.push(etat.selection);
    memoire('quiz-' + etat.quiz.date, { choix: etat.choix });

    if (etat.index < etat.quiz.questions.length - 1) {
      etat.index += 1;
      dessinerQuestion();
    } else {
      terminer();
    }
  }

  // ── Resultats ─────────────────────────────────────────────────────────────

  function calculerPoints(score, total) {
    var p = etat.config.points;
    var somme = p.participation + p.par_bonne_reponse * score;
    if (score === total) { somme += p.sans_faute; }
    return somme;
  }

  function terminer() {
    var questions = etat.quiz.questions;
    var total = questions.length;
    var score = questions.reduce(function (s, q, i) {
      return s + (estJuste(q, etat.choix[i]) ? 1 : 0);
    }, 0);
    var points = calculerPoints(score, total);

    texte($('res-date'), dateLisible(etat.quiz.date) + ' · ' + etat.quiz.matiere_affichee);

    var bilan = $('bilan');
    bilan.innerHTML = '';
    questions.forEach(function (q, i) {
      var li = document.createElement('li');
      var ok = estJuste(q, etat.choix[i]);
      li.className = ok ? 'juste' : 'faux';
      li.textContent = ok ? '✓' : '✕';
      li.setAttribute('aria-label', 'Question ' + (i + 1) + (ok ? ' juste' : ' fausse'));
      bilan.appendChild(li);
    });

    var phrase;
    if (score === total) { phrase = total + ' sur ' + total + ', sans faute.'; }
    else if (score === 0) { phrase = 'Aucune bonne réponse cette fois.'; }
    else if (score === 1) { phrase = 'Une bonne réponse sur ' + total + '.'; }
    else { phrase = score + ' bonnes réponses sur ' + total + '.'; }
    texte($('score-texte'), phrase);
    texte($('gain'), '+ ' + points + ' points');

    dessinerCorrections(questions);
    afficher('resultats');

    var bonus = etat.config.bonus_semaine;
    var palier = etat.config.palier || {};

    var charge = {
      action: 'resultat',
      date: etat.quiz.date,
      matiere: etat.quiz.matiere_affichee,
      niveau: etat.quiz.niveau,
      score: score,
      total: total,
      points: points,
      bonus_jours_requis: etat.quiz.vacances ? bonus.jours_requis_vacances : bonus.jours_requis,
      bonus_points: bonus.points,
      bonus_libelle: bonus.libelle,
      palier_pas: palier.pas,
      palier_libelle: palier.libelle
    };

    envoyer(charge);
  }

  // Envoi du resultat. En cas d'echec on garde la charge sous le coude :
  // elle repartira toute seule a la prochaine ouverture de la page.
  function envoyer(charge) {
    var bloc = $('synchro');
    bloc.hidden = false;
    bloc.className = 'synchro';
    bloc.textContent = 'Enregistrement de tes points…';

    ecrireCarnet(charge).then(function (rep) {
      if (rep && rep.ok) {
        memoire('attente', null);
        bloc.hidden = true;
        annoncer(rep);
        return;
      }

      if (rep && rep.raison === 'deja_enregistre') {
        memoire('attente', null);
        bloc.hidden = true;
        texte($('gain'), 'Quiz déjà validé aujourd\'hui — pas de points en plus');
        return;
      }

      // Echec : on conserve et on propose de reessayer.
      memoire('attente', charge);
      bloc.className = 'synchro echec';
      bloc.textContent = '';
      var texteEchec = document.createElement('span');
      texteEchec.textContent = rep && rep.raison === 'carnet_absent'
        ? 'Le carnet de points n\'est pas relié : tes points ne sont pas encore enregistrés.'
        : 'Tes points n\'ont pas pu être enregistrés. Vérifie ta connexion.';
      var bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.textContent = 'Réessayer';
      bouton.addEventListener('click', function () { envoyer(charge); });
      bloc.appendChild(texteEchec);
      bloc.appendChild(bouton);
    });
  }

  function annoncer(rep) {
    var lignes = [];
    if (rep.bonus_semaine) {
      lignes.push('Semaine complète : + ' + rep.bonus_semaine.points + ' points de bonus.');
    }
    (rep.paliers || []).forEach(function (p) {
      lignes.push(p.seuil + ' points gagnés depuis le début : « '
        + p.libelle + ' » est à toi.');
    });
    if (!lignes.length) { return; }

    var bloc = $('annonce-hebdo');
    bloc.innerHTML = '';
    lignes.forEach(function (l) {
      var p = document.createElement('p');
      p.textContent = l;
      bloc.appendChild(p);
    });
    bloc.hidden = false;
  }

  function dessinerCorrections(questions) {
    var liste = $('corrections');
    liste.innerHTML = '';

    questions.forEach(function (q, i) {
      var ok = estJuste(q, etat.choix[i]);
      var li = document.createElement('li');

      var verdict = document.createElement('span');
      verdict.className = 'verdict ' + (ok ? 'juste' : 'faux');
      verdict.textContent = ok ? 'Question ' + (i + 1) + ' · juste'
                               : 'Question ' + (i + 1) + ' · à revoir';
      li.appendChild(verdict);

      var enonce = document.createElement('p');
      enonce.className = 'question';
      enonce.textContent = q.question;
      li.appendChild(enonce);

      var reponses = document.createElement('ul');
      reponses.className = 'reponses';

      if (!ok) {
        reponses.appendChild(ligneReponse(
          'Ta réponse', reponseLisible(q, etat.choix[i]), 'mauvaise'));
      }
      reponses.appendChild(ligneReponse('Bonne réponse', bonneReponseLisible(q), 'bonne'));
      li.appendChild(reponses);

      if (q.explication) {
        var expl = document.createElement('p');
        expl.className = 'explication';
        expl.textContent = q.explication;
        li.appendChild(expl);
      }

      liste.appendChild(li);
    });
  }

  function ligneReponse(etiquette, valeur, classe) {
    var li = document.createElement('li');
    var e = document.createElement('span');
    e.className = 'etiquette';
    e.textContent = etiquette;
    var v = document.createElement('span');
    v.className = classe;
    v.textContent = valeur;
    li.appendChild(e);
    li.appendChild(v);
    return li;
  }

  // ── Cagnotte ──────────────────────────────────────────────────────────────

  function ouvrirCagnotte() {
    afficher('cagnotte');
    texte($('solde'), '…');
    texte($('solde-detail'), '');

    if (!urlCarnet()) {
      texte($('solde'), '—');
      texte($('solde-detail'),
        'Le carnet de points n\'est pas encore relié. Renseigne « sheets_url » dans config.json.');
      return;
    }

    lireCarnet().then(function (data) {
      if (!data || data.ok === false) {
        texte($('solde'), '—');
        texte($('solde-detail'), 'Carnet de points momentanément indisponible.');
        return;
      }
      dessinerCagnotte(data);
    });
  }

  function dessinerCagnotte(data) {
    texte($('solde'), data.solde + ' pts');

    var detail = data.total_gagne + ' points gagnés depuis le début';
    if (data.total_depense) { detail += ', ' + data.total_depense + ' déjà échangés'; }
    if (data.disponible !== data.solde) {
      detail += '. ' + (data.solde - data.disponible) + ' points sont réservés par une demande en attente';
    }
    texte($('solde-detail'), detail + '.');

    var faits = {};
    (data.resultats || []).forEach(function (r) { faits[r.date] = true; });

    var lundi = data.semaine.lundi.split('-');
    var ol = $('semaine');
    ol.innerHTML = '';
    for (var i = 0; i < 6; i++) {
      var d = new Date(Number(lundi[0]), Number(lundi[1]) - 1, Number(lundi[2]) + i);
      var iso = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2)
              + '-' + ('0' + d.getDate()).slice(-2);
      var li = document.createElement('li');
      li.textContent = JOURS_COURTS[i];
      if (faits[iso]) { li.className = 'fait'; }
      ol.appendChild(li);
    }

    var bonus = etat.config.bonus_semaine;
    var requis = (etat.quiz && etat.quiz.vacances)
      ? bonus.jours_requis_vacances : bonus.jours_requis;
    var restants = Math.max(0, requis - data.semaine.jours);
    texte($('semaine-texte'), restants === 0
      ? 'Semaine complète : le bonus de ' + bonus.points + ' points est acquis.'
      : restants + (restants > 1 ? ' quiz restants' : ' quiz restant')
        + ' pour le bonus de ' + bonus.points + ' points.');

    dessinerPalier(data);
    dessinerBoutique(data);
    dessinerJournal(data);
  }

  function dessinerPalier(data) {
    var palier = etat.config.palier;
    var bloc = $('palier');
    if (!palier || !palier.pas) { bloc.hidden = true; return; }

    var acquis = data.paliers_atteints * palier.pas;
    var fait = Math.max(0, data.total_gagne - acquis);
    var reste = Math.max(0, palier.pas - fait);
    var part = Math.min(100, Math.round((fait / palier.pas) * 100));

    $('palier-libelle').textContent = palier.libelle;
    $('palier-jauge').style.width = part + '%';
    $('palier-texte').textContent = reste === 0
      ? 'Palier atteint. Regarde plus bas dans tes récompenses.'
      : 'Encore ' + reste + ' points à gagner (' + fait + ' / ' + palier.pas + ').';
    bloc.hidden = false;
  }

  function dessinerBoutique(data) {
    var conteneur = $('boutique');
    conteneur.innerHTML = '';

    (etat.config.boutique || []).forEach(function (article) {
      var bloc = document.createElement('div');
      bloc.className = 'article';

      var infos = document.createElement('div');
      infos.className = 'infos';
      var libelle = document.createElement('div');
      libelle.className = 'libelle';
      libelle.textContent = article.libelle;
      var cout = document.createElement('div');
      cout.className = 'cout';
      var manque = article.cout - data.disponible;
      var epuise = article.max_par_mois > 0
        && (data.achats_du_mois || {})[article.id] >= article.max_par_mois;

      cout.textContent = epuise
        ? article.cout + ' pts · déjà pris ce mois-ci'
        : (manque > 0
            ? article.cout + ' pts · il te manque ' + manque + ' pts'
            : article.cout + ' pts'
              + (article.max_par_mois > 0 ? ' · une fois par mois' : ''));
      infos.appendChild(libelle);
      infos.appendChild(cout);

      var bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.textContent = 'Demander';
      bouton.disabled = epuise || manque > 0;
      bouton.addEventListener('click', function () {
        bouton.disabled = true;
        bouton.textContent = 'Envoi…';
        ecrireCarnet({
          action: 'demande', id: article.id,
          libelle: article.libelle, cout: article.cout,
          max_par_mois: article.max_par_mois
        }).then(function (rep) {
          if (rep && rep.ok) {
            bouton.textContent = 'Demandé';
            dessinerCagnotte(rep.etat);
          } else if (rep && rep.raison === 'limite_mensuelle') {
            bouton.textContent = 'Le mois prochain';
            cout.textContent = article.cout + ' pts · déjà pris ce mois-ci';
          } else {
            bouton.textContent = 'Réessayer';
            bouton.disabled = false;
          }
        });
      });

      bloc.appendChild(infos);
      bloc.appendChild(bouton);
      conteneur.appendChild(bloc);
    });
  }

  var STATUTS = {
    acquis: 'acquis',
    en_attente: 'en attente',
    approuve: 'validée',
    refuse: 'refusée'
  };

  function dessinerJournal(data) {
    var ul = $('journal');
    ul.innerHTML = '';
    var lignes = (data.recompenses || []).slice().reverse();

    if (!lignes.length) {
      var vide = document.createElement('li');
      vide.className = 'vide';
      vide.textContent = 'Encore aucune récompense. Ça vient.';
      ul.appendChild(vide);
      return;
    }

    lignes.forEach(function (r) {
      var li = document.createElement('li');
      var libelle = document.createElement('span');
      libelle.textContent = r.libelle;
      var statut = document.createElement('span');
      statut.className = 'statut';
      statut.textContent = STATUTS[r.statut] || r.statut;
      li.appendChild(libelle);
      li.appendChild(statut);
      ul.appendChild(li);
    });
  }

  // ── Demarrage ─────────────────────────────────────────────────────────────

  function demarrer() {
    var params = new URLSearchParams(location.search);
    var date = params.get('date') || dateParis();

    Promise.all([
      fetch('../config.json?v=' + Date.now()).then(function (r) { return r.json(); }),
      fetch('../data/' + date + '.json').then(function (r) {
        if (!r.ok) { throw new Error('introuvable'); }
        return r.json();
      })
    ]).then(function (res) {
      etat.config = res[0];
      etat.quiz = res[1];

      // Un resultat n'avait pas pu partir la derniere fois : on le renvoie.
      var enAttente = memoire('attente');
      if (enAttente && enAttente.action === 'resultat') {
        ecrireCarnet(enAttente).then(function (rep) {
          if (rep && (rep.ok || rep.raison === 'deja_enregistre')) {
            memoire('attente', null);
          }
        });
      }

      document.body.dataset.matiere = etat.quiz.matiere;
      document.title = etat.quiz.matiere_affichee + ' — quiz du jour';
      texte($('quiz-date'), dateLisible(etat.quiz.date) + ' · '
        + (etat.quiz.niveau_affiche || etat.quiz.niveau));
      texte($('quiz-matiere'), etat.quiz.matiere_affichee);
      texte($('quiz-chapitre'), etat.quiz.chapitre || '');
      $('bouton-suivant').textContent = 'Valider';
      texte($('quiz-note'), 'Les corrections arrivent à la fin des '
        + etat.quiz.questions.length + ' questions.');

      var repris = memoire('quiz-' + date);
      if (repris && repris.choix && repris.choix.length === etat.quiz.questions.length) {
        etat.choix = repris.choix;
        terminer();
        return;
      }

      dessinerQuestion();
      afficher('quiz');
    }).catch(function () {
      texte($('message-vide'),
        'Aucun quiz pour le ' + dateLisible(date) + '. '
        + 'Le quiz est publié du lundi au samedi à 16 h.');
      afficher('vide');
    });

    $('bouton-suivant').addEventListener('click', questionSuivante);
    $('bouton-cagnotte').addEventListener('click', ouvrirCagnotte);
    $('bouton-retour').addEventListener('click', function () { afficher('resultats'); });
  }

  demarrer();
})();
