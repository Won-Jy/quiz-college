#!/usr/bin/env python3
"""
Quiz du jour — college
Genere 5 QCM conformes au programme francais, les enregistre en JSON
et envoie le lien par e-mail. Tout le parametrage vit dans config.json.
"""

import datetime
import json
import os
import re
import smtplib
import sys
import urllib.request
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from zoneinfo import ZoneInfo

import anthropic

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
HISTORY_FILE = DATA_DIR / "history.json"
PARIS = ZoneInfo("Europe/Paris")

NIVEAUX = ["6eme", "5eme", "4eme", "3eme", "2nde", "1ere", "terminale"]

NIVEAUX_AFFICHES = {
    "6eme": "6\u00e8me", "5eme": "5\u00e8me", "4eme": "4\u00e8me", "3eme": "3\u00e8me",
    "2nde": "2nde", "1ere": "1\u00e8re", "terminale": "Terminale",
}

MATIERES = {
    "francais": {"nom": "Francais", "affiche": "Français"},
    "anglais": {"nom": "Anglais", "affiche": "Anglais"},
    "maths": {"nom": "Mathematiques", "affiche": "Mathématiques"},
    "histoire": {"nom": "Histoire-Geographie", "affiche": "Histoire-Géographie"},
}

JOURS_FR = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS_FR = ["janvier", "février", "mars", "avril", "mai", "juin",
           "juillet", "août", "septembre", "octobre", "novembre", "décembre"]

DIFFICULTES = {
    "facile": "Reste sur les attendus de base du chapitre. Les enonces sont courts et directs.",
    "normale": "Vise le niveau attendu en controle ordinaire : application directe puis courte reflexion.",
    "exigeante": "Vise le haut du programme : raisonnement en deux etapes, pieges classiques assumes.",
}


# ── Utilitaires ──────────────────────────────────────────────────────────────

def charger(nom):
    with open(ROOT / nom, encoding="utf-8") as f:
        return json.load(f)


def date_fr(d):
    return f"{JOURS_FR[d.weekday()]} {d.day} {MOIS_FR[d.month - 1]} {d.year}"


def niveau_du_jour(cfg, aujourdhui):
    if cfg.get("niveau_manuel"):
        return cfg["niveau_manuel"]
    base = cfg.get("niveau_base_annee", 2026)
    # Passage au niveau superieur le 1er juin de chaque annee.
    index = aujourdhui.year - base if aujourdhui.month >= 6 else aujourdhui.year - base - 1
    return NIVEAUX[max(0, min(index, len(NIVEAUX) - 1))]


def periode_vacances(cfg, aujourdhui):
    for v in cfg.get("vacances", []):
        debut = datetime.date.fromisoformat(v["debut"])
        fin = datetime.date.fromisoformat(v["fin"])
        if debut <= aujourdhui <= fin:
            return v["nom"]
    return None


def lire_historique():
    if HISTORY_FILE.exists():
        try:
            return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return []


def choisir_chapitre(programme, niveau, matiere, historique):
    """Rotation deterministe : on avance d'un chapitre a chaque passage de la matiere."""
    chapitres = programme.get(niveau, {}).get(matiere, [])
    if not chapitres:
        return None, []
    deja = [h for h in historique if h.get("matiere") == matiere and h.get("niveau") == niveau]
    chapitre = chapitres[len(deja) % len(chapitres)]
    notions_recentes = []
    for h in deja[-4:]:
        notions_recentes.extend(h.get("notions", []))
    return chapitre, notions_recentes


# ── Generation ───────────────────────────────────────────────────────────────

def format_quiz(cfg):
    """Nombre de questions par type. Retro-compatible avec l'ancien nb_questions."""
    fmt = cfg.get("format")
    if isinstance(fmt, dict):
        return {"qcm": int(fmt.get("qcm", 0)), "saisie": int(fmt.get("saisie", 0))}
    return {"qcm": int(cfg.get("nb_questions", 5)), "saisie": 0}


def construire_prompt(cfg, niveau, matiere, chapitre, notions_recentes):
    fmt = format_quiz(cfg)
    n_qcm, n_saisie = fmt["qcm"], fmt["saisie"]
    total = n_qcm + n_saisie
    label = MATIERES[matiere]["nom"]
    consigne_diff = DIFFICULTES.get(cfg.get("difficulte", "normale"), DIFFICULTES["normale"])

    if chapitre:
        cadre = f"Chapitre du jour : {chapitre}\nToutes les questions portent sur ce seul chapitre."
    else:
        cadre = (f"Choisis un chapitre representatif du programme officiel de {label} "
                 f"en classe de {niveau}, et fais porter toutes les questions dessus.")

    a_eviter = ""
    if notions_recentes:
        liste = ", ".join(notions_recentes[:12])
        a_eviter = f"\nNotions deja travaillees ces derniers jours, a ne pas reprendre : {liste}"

    specifique = ""
    if matiere == "anglais":
        specifique = ("\nCas particulier de l'anglais : les consignes, les propositions de reponse "
                      "explicatives et les explications sont en francais ; seules les phrases a "
                      "completer ou a analyser sont en anglais. Pour la question de saisie, "
                      "l'eleve tape un mot ou une forme verbale en anglais.")
    if matiere == "maths":
        specifique = ("\nCas particulier des maths : ecris les nombres decimaux avec une virgule "
                      "(3,5 et non 3.5). Pas de LaTeX : utilise du texte simple (2/3, 5 cm2, x2 pour "
                      "le carre). Pour la question de saisie, precise l'unite attendue dans l'enonce "
                      "et n'attends que le nombre dans la reponse.")

    bloc_saisie = ""
    if n_saisie:
        bloc_saisie = f"""
- Les {n_saisie} dernières questions sont de type "saisie" : l'élève tape la réponse au clavier, sans propositions. Elles doivent avoir une réponse unique, courte et vérifiable : une forme conjuguée, l'orthographe d'un mot, le résultat d'un calcul, une année, un nom propre. Jamais de question ouverte ni de réponse en plusieurs mots libres.
- Pour chaque question de saisie, "reponses_acceptees" liste toutes les formes exactes acceptables. Majuscules et minuscules sont indifférentes, inutile de les dédoubler. Pour un nombre, donne la forme avec virgule et avec point, et la fraction si pertinent. Pour un nom, avec et sans article. Pour une forme verbale, seulement la forme attendue — une faute d'accent ou d'accord doit rester une erreur."""

    exemple_saisie = ""
    if n_saisie:
        exemple_saisie = ', {"type": "saisie", "question": "...", "reponses_acceptees": ["...", "..."], "explication": "...", "notion": "..."}'

    return f"""Tu es professeur au college en France. Rédige {total} questions de {label} pour une élève de {niveau}, strictement conformes au programme officiel de l'Éducation nationale.

{cadre}
Niveau de difficulté : {consigne_diff}{a_eviter}{specifique}

Contraintes de rédaction :
- Les {n_qcm} premières questions sont des QCM de type "qcm" à 4 propositions, une seule bonne réponse.{bloc_saisie}
- Progression : la question 1 est la plus accessible, la dernière la plus exigeante.
- Les mauvaises propositions des QCM correspondent à des erreurs que les élèves commettent vraiment, jamais à des réponses absurdes ou fantaisistes.
- L'explication fait une à trois phrases, tutoie l'élève, et rappelle la règle ou le raisonnement — pas seulement la bonne réponse.
- Le champ "notion" nomme en trois mots maximum le point précis testé.
- Aucune référence à une page de manuel ou à un cours particulier.
- Tout est rédigé en français.

Réponds uniquement par un objet JSON valide, sans texte autour et sans balises Markdown :
{{"questions": [{{"type": "qcm", "question": "...", "options": ["...", "...", "...", "..."], "reponse": 0, "explication": "...", "notion": "..."}}{exemple_saisie}]}}

Le champ "reponse" d'un QCM est l'index (0 à 3) de la bonne proposition dans "options"."""


def extraire_json(reponse):
    """Concatene les blocs texte (ignore les blocs de reflexion) puis parse."""
    brut = "".join(b.text for b in reponse.content if getattr(b, "type", "") == "text").strip()
    brut = re.sub(r"^```(?:json)?|```$", "", brut, flags=re.MULTILINE).strip()
    debut, fin = brut.find("{"), brut.rfind("}")
    if debut == -1 or fin == -1:
        raise ValueError("Aucun objet JSON dans la reponse")
    return json.loads(brut[debut:fin + 1])


def generer(cfg, prompt):
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    modele = cfg.get("modele", "claude-sonnet-5")
    fmt = format_quiz(cfg)

    derniere_erreur = None
    for tentative in (1, 2):
        try:
            rep = client.messages.create(
                model=modele,
                max_tokens=8000,
                messages=[{"role": "user", "content": prompt}],
            )
            if rep.stop_reason == "max_tokens":
                raise ValueError("Reponse tronquee (max_tokens atteint)")
            data = extraire_json(rep)
            questions = valider(data.get("questions", []), fmt)
            print(f"[OK] {len(questions)} questions generees (tentative {tentative})")
            return questions
        except Exception as e:  # noqa: BLE001
            derniere_erreur = e
            print(f"[WARN] tentative {tentative} echouee : {e}")

    raise SystemExit(f"[FATAL] Generation impossible : {derniere_erreur}")


def valider(questions, fmt):
    """Trie et nettoie : les QCM d'abord, les saisies a la fin, dans les quantites demandees."""
    qcm, saisie = [], []
    for i, q in enumerate(questions, start=1):
        base = {
            "question": str(q.get("question", "")).strip(),
            "explication": str(q.get("explication", "")).strip(),
            "notion": str(q.get("notion", "")).strip(),
        }
        if not base["question"]:
            print(f"[WARN] question {i} ignoree (enonce vide)")
            continue

        if q.get("type") == "saisie" or "reponses_acceptees" in q:
            acceptees = [str(a).strip() for a in q.get("reponses_acceptees", []) if str(a).strip()]
            if not acceptees:
                print(f"[WARN] question {i} ignoree (saisie sans reponse)")
                continue
            saisie.append(dict(base, type="saisie", reponses_acceptees=acceptees))
        else:
            options = q.get("options", [])
            reponse = q.get("reponse")
            if len(options) != 4 or not isinstance(reponse, int) or not 0 <= reponse <= 3:
                print(f"[WARN] question {i} ignoree (QCM invalide)")
                continue
            qcm.append(dict(base, type="qcm", options=[str(o).strip() for o in options],
                            reponse=reponse))

    if len(qcm) < fmt["qcm"] or len(saisie) < fmt["saisie"]:
        raise ValueError(f"{len(qcm)} QCM et {len(saisie)} saisies valides, "
                         f"attendu {fmt['qcm']} et {fmt['saisie']}")

    propres = qcm[:fmt["qcm"]] + saisie[:fmt["saisie"]]
    for i, q in enumerate(propres, start=1):
        q["id"] = i
    return propres


# ── E-mail ───────────────────────────────────────────────────────────────────

def lire_solde(cfg):
    url = cfg.get("sheets_url", "")
    if not url.startswith("http"):
        return None
    try:
        with urllib.request.urlopen(f"{url}?action=etat", timeout=15) as r:
            return json.loads(r.read().decode()).get("solde")
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] solde indisponible : {e}")
        return None


COULEURS = {
    "francais": "#1F4BFF",
    "anglais": "#D42222",
    "maths": "#0B8F5A",
    "histoire": "#7A4FBF",
}


def envoyer_email(cfg, aujourdhui, matiere, niveau, chapitre, vacances, solde):
    niveau_aff = NIVEAUX_AFFICHES.get(niveau, niveau)
    url = f"{cfg['base_url']}/quiz/?date={aujourdhui.isoformat()}"
    couleur = COULEURS.get(matiere, "#1F4BFF")
    affiche = MATIERES[matiere]["affiche"]
    fmt = format_quiz(cfg)
    n = fmt["qcm"] + fmt["saisie"]
    pts = cfg["points"]
    max_jour = pts["participation"] + pts["par_bonne_reponse"] * n + pts["sans_faute"]

    bloc_solde = ""
    if solde is not None:
        bloc_solde = (f'<p style="margin:0 0 18px;font-size:14px;color:#555;">'
                      f'Tu as <b style="color:#000;">{solde} points</b> dans ta cagnotte.</p>')

    bloc_vacances = ""
    if vacances:
        bonus = cfg["bonus_semaine"]
        jr = bonus["jours_requis_vacances"]
        bloc_vacances = (f'<p style="margin:0 0 18px;font-size:14px;color:#555;">'
                         f'Vacances de {vacances} : {jr} quiz suffisent cette semaine '
                         f'pour le bonus de {bonus["points"]} points.</p>')

    html = f"""<html><body style="margin:0;padding:24px;background:#fff;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;
  color:#000;">
<div style="max-width:480px;margin:auto;">
  <div style="height:8px;background:{couleur};margin-bottom:22px;"></div>
  <p style="margin:0 0 4px;font-size:13px;color:#777;">{date_fr(aujourdhui)}</p>
  <h1 style="margin:0 0 6px;font-size:30px;line-height:1.1;letter-spacing:-0.02em;">{affiche}</h1>
  <p style="margin:0 0 20px;font-size:15px;color:#333;">{chapitre or 'Programme de ' + niveau_aff}</p>
  <p style="margin:0 0 18px;font-size:15px;line-height:1.6;">
    {n} questions, niveau {niveau_aff}{' — dont ' + str(fmt['saisie']) + ' à taper' if fmt['saisie'] else ''}. Jusqu'à <b>{max_jour} points</b> à gagner aujourd'hui.
  </p>
  {bloc_solde}{bloc_vacances}
  <a href="{url}" style="display:inline-block;padding:15px 30px;background:{couleur};
     color:#fff;text-decoration:none;font-weight:700;font-size:16px;
     box-shadow:4px 4px 0 #000;">Commencer le quiz</a>
  <p style="margin:32px 0 0;font-size:12px;color:#999;line-height:1.5;">
    Les réponses et les explications s'affichent une fois les {n} questions terminées.
  </p>
</div>
</body></html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"{affiche} — quiz du {aujourdhui.day} {MOIS_FR[aujourdhui.month - 1]}"
    msg["From"] = os.environ["GMAIL_USER"]
    msg["To"] = cfg["destinataire"]
    msg.attach(MIMEText(html, "html", "utf-8"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
        s.login(os.environ["GMAIL_USER"], os.environ["GMAIL_APP_PASSWORD"])
        s.sendmail(os.environ["GMAIL_USER"], cfg["destinataire"], msg.as_string())
    print(f"[OK] E-mail envoye a {cfg['destinataire']}")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    cfg = charger("config.json")
    programme = charger("programme.json")
    aujourdhui = datetime.datetime.now(PARIS).date()

    jour = str(aujourdhui.isoweekday())
    matiere = cfg["planning"].get(jour)
    if not matiere:
        print(f"[SKIP] Aucune matiere prevue le jour {jour}")
        return
    if matiere not in MATIERES:
        raise SystemExit(f"[FATAL] Matiere inconnue dans le planning : {matiere}")

    niveau = niveau_du_jour(cfg, aujourdhui)
    vacances = periode_vacances(cfg, aujourdhui)
    historique = lire_historique()
    chapitre, recentes = choisir_chapitre(programme, niveau, matiere, historique)

    print(f"[START] {aujourdhui} · {matiere} · {niveau} · {chapitre or 'chapitre libre'}"
          + (f" · vacances {vacances}" if vacances else ""))

    questions = generer(cfg, construire_prompt(cfg, niveau, matiere, chapitre, recentes))

    DATA_DIR.mkdir(exist_ok=True)
    quiz = {
        "date": aujourdhui.isoformat(),
        "matiere": matiere,
        "matiere_affichee": MATIERES[matiere]["affiche"],
        "niveau": niveau,
        "niveau_affiche": NIVEAUX_AFFICHES.get(niveau, niveau),
        "chapitre": chapitre,
        "vacances": vacances,
        "genere_le": datetime.datetime.now(PARIS).isoformat(timespec="seconds"),
        "questions": questions,
    }
    (DATA_DIR / f"{aujourdhui.isoformat()}.json").write_text(
        json.dumps(quiz, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] data/{aujourdhui.isoformat()}.json")

    historique.append({
        "date": aujourdhui.isoformat(),
        "matiere": matiere,
        "niveau": niveau,
        "chapitre": chapitre,
        "notions": [q["notion"] for q in questions if q["notion"]],
    })
    HISTORY_FILE.write_text(
        json.dumps(historique[-120:], ensure_ascii=False, indent=2), encoding="utf-8")

    envoyer_email(cfg, aujourdhui, matiere, niveau, chapitre, vacances, lire_solde(cfg))


if __name__ == "__main__":
    sys.exit(main())
