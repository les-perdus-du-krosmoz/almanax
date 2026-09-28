#!/usr/bin/env python3
"""
Génère les données du site Almanax à partir de l'API dofusdude (Dofus 3).

Sorties :
  docs/data/almanax.json      données lues par le site (jours à venir + tags)
  reports/types_a_classer.md  bonus non classés, avec leurs vraies descriptions
  reports/coverage_log.csv    jusqu'où l'API va, jour après jour (paliers ou glissant ?)
  reports/state.json          date du dernier envoi Discord (évite les doublons)

Usage :
  python scripts/generate.py                 # génère seulement
  python scripts/generate.py --notify        # + post Discord si pas encore fait aujourd'hui
  python scripts/generate.py --force-notify  # + post Discord même si déjà fait

Aucune dépendance : bibliothèque standard uniquement.
"""
import argparse
import datetime as dt
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "config" / "categories.json"
OUT = ROOT / "docs" / "data" / "almanax.json"
REPORTS = ROOT / "reports"
STATE = REPORTS / "state.json"
COVERAGE_LOG = REPORTS / "coverage_log.csv"
TO_CLASSIFY = REPORTS / "types_a_classer.md"

API = "https://api.dofusdu.de/dofus3/v1"
LANG = "fr"
TZ = ZoneInfo("Europe/Paris")
CHUNK_DAYS = 30        # l'API refuse les plages > 35 jours
MAX_DAYS = 400         # garde-fou si l'API se mettait à tout renvoyer
MIN_DAYS = 7           # en dessous, on considère la génération ratée et on garde l'ancien fichier
HEADERS = {"User-Agent": "almanax-site (GitHub Actions)"}

JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
        "août", "septembre", "octobre", "novembre", "décembre"]


class NotFound(Exception):
    pass


# ---------- API ----------

def get_json(path, params=None, retries=3):
    url = f"{API}/{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise NotFound(url) from e
            retryable = e.code == 429 or e.code >= 500
            if not retryable or attempt == retries - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
        time.sleep(2 ** attempt)


def fetch_days(today, fetch=get_json, pause=0.3):
    """Récupère tous les jours à partir d'aujourd'hui, jusqu'à la fin des données de l'API."""
    days = {}
    start = today
    limit = today + dt.timedelta(days=MAX_DAYS)
    while start <= limit:
        stop = min(start + dt.timedelta(days=CHUNK_DAYS - 1), limit)
        params = {
            "range[from]": start.isoformat(),
            "range[to]": stop.isoformat(),
            "range[size]": "-1",
            "timezone": "Europe/Paris",
        }
        try:
            batch = fetch(f"{LANG}/almanax", params)
        except NotFound:
            batch = None

        if batch:
            for e in batch:
                days[e["date"][:10]] = e
            if len(batch) < (stop - start).days + 1:
                break  # l'API s'est arrêtée en cours de plage : fin des données
        else:
            # La plage déborde la fin des données : on finit jour par jour.
            d = start
            while d <= stop:
                try:
                    e = fetch(f"{LANG}/almanax/{d.isoformat()}")
                except NotFound:
                    break
                days[e["date"][:10]] = e
                d += dt.timedelta(days=1)
            break
        start = stop + dt.timedelta(days=1)
        time.sleep(pause)  # rester poli avec une API bénévole
    return days


# ---------- transformation ----------

def tags_for(type_id, cfg, unknown):
    if type_id in cfg["types"]:
        return cfg["types"][type_id]
    if type_id not in cfg.get("a_classer", []):
        unknown.add(type_id)
    return [cfg["fallback_tag"]]


def slim(e, cfg, unknown):
    """Ne garde que ce dont le site a besoin. Accès défensifs : un champ absent donne une valeur vide."""
    bonus = e.get("bonus") or {}
    btype = bonus.get("type") or {}
    tribute = e.get("tribute") or {}
    item = tribute.get("item") or {}
    images = item.get("image_urls") or {}
    type_id = btype.get("id", "")
    return {
        "date": e["date"][:10],
        "bonus": {"type": type_id, "name": btype.get("name", ""), "description": bonus.get("description", "")},
        "tags": tags_for(type_id, cfg, unknown),
        "tribute": {
            "name": item.get("name", ""),
            "quantity": tribute.get("quantity"),
            # Toujours l'URL fournie par l'API : l'id de l'image ne correspond pas à ankama_id.
            "image": images.get("sd") or images.get("icon") or images.get("hq"),
            "ankama_id": item.get("ankama_id"),
        },
        "kamas": e.get("reward_kamas"),
        "xp": e.get("reward_xp"),
    }


def long_date(iso):
    d = dt.date.fromisoformat(iso)
    day = "1er" if d.day == 1 else str(d.day)
    return f"{JOURS[d.weekday()].capitalize()} {day} {MOIS[d.month - 1]}"


# ---------- rapports ----------

def write_classify_report(days, cfg, unknown, today):
    pending = set(cfg.get("a_classer", []))
    groups = {}
    for d in days:
        t = d["bonus"]["type"]
        if t in pending or t in unknown:
            groups.setdefault(t, []).append(d)

    lines = [
        "# Bonus à classer",
        "",
        f"Généré le {today.isoformat()}. Ces bonus sont affichés dans « Autre » tant qu'ils ne sont pas classés dans `config/categories.json`.",
        "",
    ]
    if unknown:
        lines += ["## Nouveaux ids (absents de categories.json)", ""]
        lines += [f"- `{t}`" for t in sorted(unknown)]
        lines.append("")
    if not groups:
        lines.append("Aucun bonus à classer sur la période couverte.")
    for t in sorted(groups):
        ds = groups[t]
        descs = sorted({d["bonus"]["description"] for d in ds})
        lines += [f"## `{t}` : {ds[0]['bonus']['name']}", "",
                  f"{len(ds)} jour(s), prochain le {ds[0]['date']}.", ""]
        lines += [f"- {x}" for x in descs[:5]]
        lines.append("")
    never_seen = sorted(pending - set(groups))
    if never_seen:
        lines += ["## À classer mais absents de la période couverte", ""]
        lines += [f"- `{t}`" for t in never_seen]
        lines.append("")
    TO_CLASSIFY.write_text("\n".join(lines), encoding="utf-8")


def log_coverage(today, coverage_until):
    rows = COVERAGE_LOG.read_text(encoding="utf-8").splitlines() if COVERAGE_LOG.exists() else ["run_date,coverage_until"]
    if rows[-1].split(",")[0] != today.isoformat():
        rows.append(f"{today.isoformat()},{coverage_until}")
        COVERAGE_LOG.write_text("\n".join(rows) + "\n", encoding="utf-8")


# ---------- Discord ----------

def post_webhook(url, payload):
    req = urllib.request.Request(
        url, data=json.dumps(payload).encode("utf-8"), method="POST",
        headers={**HEADERS, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30):
        pass


def build_discord_payload(out, today_iso, site_url, watch_tags, watch_days=7):
    by_date = {d["date"]: d for d in out["days"]}
    day = by_date.get(today_iso)
    if day is None:
        return None
    tags = out["tags"]
    label = lambda t: f"{tags[t]['emoji']} {tags[t]['label']}" if t in tags else t
    link = f"{site_url.rstrip('/')}/?date={today_iso}" if site_url else None

    tr = day["tribute"]
    main = {
        "title": f"Almanax : {long_date(today_iso)}",
        "description": f"**{day['bonus']['name']}** ({', '.join(label(t) for t in day['tags'])})\n{day['bonus']['description']}",
        "color": 0xB07A12,
        "fields": [{"name": "Offrande", "value": f"{tr['quantity']} × {tr['name']}", "inline": True}],
    }
    if day.get("kamas"):
        main["fields"].append({"name": "Kamas", "value": f"{day['kamas']:,}".replace(",", " "), "inline": True})
    if tr.get("image"):
        main["thumbnail"] = {"url": tr["image"]}
    if link:
        main["url"] = link
    embeds = [main]

    today = dt.date.fromisoformat(today_iso)
    lines = []
    for i in range(1, watch_days + 1):
        iso = (today + dt.timedelta(days=i)).isoformat()
        d = by_date.get(iso)
        if d and set(d["tags"]) & watch_tags:
            lines.append(f"**{long_date(iso)}** : {d['bonus']['description']}\n"
                         f"↳ offrande : {d['tribute']['quantity']} × {d['tribute']['name']}")
    if lines:
        embeds.append({"title": f"À surveiller ({watch_days} jours)", "description": "\n".join(lines)[:4000], "color": 0x2F6F8F})
    return {"embeds": embeds}


def maybe_notify(out, force):
    webhook = os.getenv("DISCORD_WEBHOOK_URL")
    if not webhook:
        print("Discord : pas de DISCORD_WEBHOOK_URL, envoi ignoré.")
        return
    now = dt.datetime.now(TZ)
    today_iso = now.date().isoformat()
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    if not force:
        if state.get("last_notified") == today_iso:
            print("Discord : déjà envoyé aujourd'hui.")
            return
        if now.hour >= 20:
            # Run de 23h en hiver : c'est encore la veille à Paris, le post viendra au run suivant.
            print("Discord : trop tard dans la journée, envoi ignoré.")
            return
    watch = {t.strip() for t in (os.getenv("WATCH_TAGS") or "xp,butin,challenge,metier").split(",") if t.strip()}
    payload = build_discord_payload(out, today_iso, os.getenv("SITE_URL", ""), watch)
    if payload is None:
        print("Discord : pas de données pour aujourd'hui, envoi ignoré.")
        return
    post_webhook(webhook, payload)
    state["last_notified"] = today_iso
    STATE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    print("Discord : envoyé.")


# ---------- main ----------

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--notify", action="store_true", help="poster sur Discord si pas encore fait aujourd'hui")
    ap.add_argument("--force-notify", action="store_true", help="poster sur Discord même si déjà fait")
    args = ap.parse_args(argv)

    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    today = dt.datetime.now(TZ).date()

    raw = fetch_days(today)
    if len(raw) < MIN_DAYS:
        sys.exit(f"Seulement {len(raw)} jour(s) récupéré(s) : on garde l'ancien fichier.")

    unknown = set()
    days = [slim(raw[k], cfg, unknown) for k in sorted(raw)]
    coverage_until = days[-1]["date"]

    out = {
        "generated_at": dt.datetime.now(TZ).isoformat(timespec="seconds"),
        "today": today.isoformat(),
        "coverage_until": coverage_until,
        "tags": cfg["tags"],
        "days": days,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    REPORTS.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    write_classify_report(days, cfg, unknown, today)
    log_coverage(today, coverage_until)

    print(f"{len(days)} jours, du {days[0]['date']} au {coverage_until}.")
    if unknown:
        print(f"Nouveaux ids de bonus : {', '.join(sorted(unknown))}")

    if args.notify or args.force_notify:
        try:
            maybe_notify(out, args.force_notify)
        except Exception as e:  # un échec Discord ne doit pas bloquer la mise à jour du site
            print(f"Discord : échec ({e}).", file=sys.stderr)


if __name__ == "__main__":
    main()
