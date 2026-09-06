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
      localStorage.setItem(cle, JSON.stringify(valeur));
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
    if (!url) { return Promise.resolve(null); }
    // text/plain evite la requete preflight, qu'Apps Script ne gere pas.
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(charge)
    })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
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

  function dessinerQuestion() {
    var q = etat.quiz.questions[etat.index];
    var total = etat.quiz.questions.length;

    dessinerPips();
    texte($('quiz-rang'), 'Question ' + (etat.index + 1) + ' sur ' + total);
    texte($('quiz-enonce'), q.question);

    var conteneur = $('quiz-options');
    conteneur.innerHTML = '';
    etat.selection = null;

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

    var suivant = $('bouton-suivant');
    suivant.disabled = true;
    suivant.textContent = (etat.index === total - 1) ? 'Terminer' : 'Valider';
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
      return s + (etat.choix[i] === q.reponse ? 1 : 0);
    }, 0);
    var points = calculerPoints(score, total);

    texte($('res-date'), dateLisible(etat.quiz.date) + ' · ' + etat.quiz.matiere_affichee);

    var bilan = $('bilan');
    bilan.innerHTML = '';
    questions.forEach(function (q, i) {
      var li = document.createElement('li');
      var ok = etat.choix[i] === q.reponse;
      li.className = ok ? 'juste' : 'faux';
      li.textContent = ok ? '✓' : '✕';
      li.setAttribute('aria-label', 'Question ' + (i + 1) + (ok ? ' juste' : ' fausse'));
      bilan.appendChild(li);
    });

    var mots = ['Aucune bonne réponse cette fois.',
      'Une bonne réponse.', 'Deux bonnes réponses.', 'Trois bonnes réponses.',
      'Quatre bonnes réponses.', 'Cinq sur cinq, sans faute.'];
    texte($('score-texte'), mots[score] || (score + ' bonnes réponses sur ' + total + '.'));
    texte($('gain'), '+ ' + points + ' points');

    dessinerCorrections(questions);
    afficher('resultats');

    var requis = etat.quiz.vacances
      ? etat.config.recompense_hebdo.jours_requis_vacances
      : etat.config.recompense_hebdo.jours_requis;

    ecrireCarnet({
      action: 'resultat',
      date: etat.quiz.date,
      matiere: etat.quiz.matiere_affichee,
      niveau: etat.quiz.niveau,
      score: score,
      total: total,
      points: points,
      jours_requis: requis,
      libelle_hebdo: etat.config.recompense_hebdo.libelle
    }).then(function (rep) {
      if (!rep) { return; }
      if (rep.ok === false && rep.raison === 'deja_enregistre') {
        texte($('gain'), 'Quiz déjà validé aujourd\'hui — pas de points en plus');
      }
      if (rep.recompense_hebdo) {
        var bloc = $('annonce-hebdo');
        bloc.textContent = 'Semaine complète : tu as gagné « '
          + rep.recompense_hebdo.libelle +' ».';
        bloc.hidden = false;
      }
    });
  }

  function dessinerCorrections(questions) {
    var liste = $('corrections');
    liste.innerHTML = '';

    questions.forEach(function (q, i) {
      var ok = etat.choix[i] === q.reponse;
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
          'Ta réponse', q.options[etat.choix[i]] || '—', 'mauvaise'));
      }
      reponses.appendChild(ligneReponse('Bonne réponse', q.options[q.reponse], 'bonne'));
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

    var requis = (etat.quiz && etat.quiz.vacances)
      ? etat.config.recompense_hebdo.jours_requis_vacances
      : etat.config.recompense_hebdo.jours_requis;
    var restants = Math.max(0, requis - data.semaine.jours);
    texte($('semaine-texte'), restants === 0
      ? 'Objectif atteint : « ' + etat.config.recompense_hebdo.libelle +' » est à toi.'
      : restants + (restants > 1 ? ' quiz restants' : ' quiz restant')
        + ' pour « ' + etat.config.recompense_hebdo.libelle + ' ».');

    dessinerBoutique(data);
    dessinerJournal(data);
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
      cout.textContent = manque > 0
        ? article.cout + ' pts · il te manque ' + manque + ' pts'
        : article.cout + ' pts';
      infos.appendChild(libelle);
      infos.appendChild(cout);

      var bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.textContent = 'Demander';
      bouton.disabled = manque > 0;
      bouton.addEventListener('click', function () {
        bouton.disabled = true;
        bouton.textContent = 'Envoi…';
        ecrireCarnet({
          action: 'demande', id: article.id,
          libelle: article.libelle, cout: article.cout
        }).then(function (rep) {
          if (rep && rep.ok) {
            bouton.textContent = 'Demandé';
            dessinerCagnotte(rep.etat);
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
    acquise: 'acquise',
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
      fetch('../config.json').then(function (r) { return r.json(); }),
      fetch('../data/' + date + '.json').then(function (r) {
        if (!r.ok) { throw new Error('introuvable'); }
        return r.json();
      })
    ]).then(function (res) {
      etat.config = res[0];
      etat.quiz = res[1];

      document.body.dataset.matiere = etat.quiz.matiere;
      document.title = etat.quiz.matiere_affichee + ' — quiz du jour';
      texte($('quiz-date'), dateLisible(etat.quiz.date) + ' · '
        + (etat.quiz.niveau_affiche || etat.quiz.niveau));
      texte($('quiz-matiere'), etat.quiz.matiere_affichee);
      texte($('quiz-chapitre'), etat.quiz.chapitre || '');
      $('bouton-suivant').textContent = 'Valider';

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
